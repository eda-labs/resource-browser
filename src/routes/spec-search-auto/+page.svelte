<script lang="ts">
    import yaml from 'js-yaml';
    import { onMount, onDestroy } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    // AnimatedBackground is dynamically imported/rendered by the layout; avoid importing here to keep it lazy
    import TopHeader from '$lib/components/TopHeader.svelte';
    import PageCredits from '$lib/components/PageCredits.svelte';

    import Render from '$lib/components/Render.svelte';
    import YangView from '$lib/components/YangView.svelte';
    import { stripResourcePrefixFQDN } from '$lib/components/functions';
    // expandAll controls removed from this auto-search page (no UI button)
    import releasesYaml from '$lib/releases.yaml?raw';
    import type { EdaRelease, ReleasesConfig } from '$lib/structure';

    const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

    let releaseName = '';
    let release: EdaRelease | null = null;
    let versions: string[] = [];
    let version = '';
    let loadingVersions = false;

    let query = '';
    let selectedTokens = new Set<string>();
    let resultsViewMode: 'tree' | 'yang' = 'yang';
    let selectedResource: string | null = null;
    let isModalOpen = false;
    let modalData: { name: string; kind?: string; version?: string; spec?: any; status?: any; fullSpec?: any; fullStatus?: any; markedFull?: { spec?: any; status?: any } } | null = null;
    let expandedPaths: string[] = [];
    let modalExpandAll = false;

    // Extract all property paths from a schema object to determine what should be expanded
    function extractPaths(obj: any, prefix: string = '', paths: string[] = []): string[] {
        if (!obj || typeof obj !== 'object') return paths;
        
        if (obj.properties) {
            for (const key of Object.keys(obj.properties)) {
                const path = prefix ? `${prefix}.${key}` : key;
                paths.push(path);
                extractPaths(obj.properties[key], path, paths);
            }
        }
        
        if (obj.items) {
            extractPaths(obj.items, prefix, paths);
        }
        
        return paths;
    }

    // Mark nodes in full schema that match the search by adding diff status
    function markMatchingNodes(fullSchema: any, matchedPaths: Set<string>, currentPath: string = ''): any {
        if (!fullSchema || typeof fullSchema !== 'object') return fullSchema;
        
        const result = { ...fullSchema };
        
        if (result.properties) {
            const newProps: any = {};
            for (const [key, value] of Object.entries(result.properties)) {
                const path = currentPath ? `${currentPath}.${key}` : key;
                const markedValue = markMatchingNodes(value, matchedPaths, path);
                
                // Mark as 'modified' (amber highlight) if this path matches search
                if (matchedPaths.has(path)) {
                    newProps[key] = { ...markedValue, __diffStatus: 'modified' };
                } else {
                    newProps[key] = markedValue;
                }
            }
            result.properties = newProps;
        }
        
        if (result.items) {
            result.items = markMatchingNodes(result.items, matchedPaths, currentPath);
        }
        
        return result;
    }

    // Initialize from URL parameters
    $: {
        const urlRelease = $page.url.searchParams.get('release');
        const urlVersion = $page.url.searchParams.get('version');
        const urlQuery = $page.url.searchParams.get('q');
        
        if (urlRelease && !releaseName) {
            releaseName = urlRelease;
            loadVersions();
        }
        if (urlVersion && !version) {
            version = urlVersion;
        }
        if (urlQuery && !query) {
            query = urlQuery;
        }
    }

    // Update URL when parameters change
    function updateURL() {
        const params = new URLSearchParams();
        if (releaseName) params.set('release', releaseName);
        if (version) params.set('version', version);
        if (query) params.set('q', query);
        
        const newUrl = params.toString() ? `?${params.toString()}` : '/spec-search-auto';
        goto(newUrl, { replaceState: true, noScroll: true, keepFocus: true });
    }

    $: selectedTokens = new Set(query.split(/\s+/).filter(Boolean));
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function ensureRenderable(schema: any) {
        if (!schema || typeof schema !== 'object') return schema;
        // If schema already has explicit type or properties/items, return as-is
        if ('type' in schema || 'properties' in schema || 'items' in schema) {
            // Common malformed wrapper: { properties: { spec: { properties: {...} }, ... } }
            // If we detect a top-level properties that contains a `spec` entry that itself
            // looks like a schema, unwrap it so the renderer shows the actual spec fields.
            try {
                if (
                    schema.properties &&
                    schema.properties.spec &&
                    (schema.properties.spec.properties || schema.properties.spec.items)
                ) {
                    return ensureRenderable(schema.properties.spec);
                }
            } catch (e) {
                // ignore and fall through to return schema as-is
            }
            return schema;
        }
        // Otherwise treat the object as properties map
        try {
            return { type: 'object', properties: schema };
        } catch (e) {
            return schema;
        }
    }

    let loading = false;
    let results: Array<{
        name: string;
        kind?: string;
        schema: any;
        version?: string;
        type?: 'spec' | 'status';
    }> = [];
    $: displayedResults = results;

    // Simple in-memory caches to avoid refetching manifests and YAML repeatedly
    const manifestCache: Map<string, any> = new Map();
    const yamlCache: Map<string, string> = new Map();

    // Prefetch manifest for the currently-selected release to reduce first-search latency
    $: if (release && release.folder && !manifestCache.has(release.folder)) {
        fetch(`/${release.folder}/manifest.json`)
            .then((r) => { if (r.ok) return r.json(); return null; })
            .then((j) => { if (j) manifestCache.set(release.folder, j); })
            .catch(() => { /* ignore prefetch errors */ });
    }

    type GroupedResult = { name: string; kind?: string; version?: string; spec?: any; status?: any; fullSpec?: any; fullStatus?: any };
    let groupedResults: GroupedResult[] = [];
    let fullSchemas = new Map<string, { spec?: any; status?: any }>();
    
    $: groupedResults = (() => {
        const map = new Map<string, GroupedResult>();
        for (const r of displayedResults) {
            const key = `${r.name}::${r.version || ''}`;
            if (!map.has(key)) {
                const fullSchema = fullSchemas.get(key) || {};
                map.set(key, {
                    name: r.name,
                    kind: r.kind,
                    version: r.version,
                    spec: undefined,
                    status: undefined,
                    fullSpec: fullSchema.spec,
                    fullStatus: fullSchema.status
                });
            }
            const entry = map.get(key)!;
            if (r.type === 'spec') entry.spec = entry.spec || r.schema;
            if (r.type === 'status') entry.status = entry.status || r.schema;
        }
        return Array.from(map.values());
    })();

    // The page attaches an event listener for `yang:pathclick` further down.

    // Results are YANG-only for auto-search page

    $: release = releaseName
        ? releasesConfig.releases.find((r) => r.name === releaseName) || null
        : null;

    async function loadVersions() {
        const rel =
            release ||
            (releaseName ? releasesConfig.releases.find((r) => r.name === releaseName) || null : null);
        if (!rel) {
            versions = [];
            version = '';
            return;
        }
        loadingVersions = true;
        try {
            const resp = await fetch(`/${rel.folder}/manifest.json`);
            if (resp.ok) {
                const manifest = await resp.json();
                const versionSet = new Set<string>();
                manifest.forEach((resource: any) => {
                    resource.versions?.forEach((v: any) => {
                        if (v && v.name) versionSet.add(v.name);
                    });
                });
                versions = Array.from(versionSet).sort();
            }
            if (!versions || versions.length === 0) {
                try {
                    const res = await import('$lib/resources.yaml?raw');
                    const resources = yaml.load(res.default) as any;
                    const allResources = Object.values(resources).flat();
                    const fallbackSet = new Set<string>();
                    allResources.forEach((r: any) => {
                        r.versions?.forEach((v: any) => {
                            if (v && v.name) fallbackSet.add(v.name);
                        });
                    });
                    versions = Array.from(fallbackSet).sort();
                } catch (e) {
                    versions = [];
                }
            }

            if (!versions.includes(version)) version = '';
            updateURL();
        } catch (e) {
            versions = [];
            version = '';
            updateURL();
        } finally {
            loadingVersions = false;
        }
    }
    
    // Update URL when version changes
    $: if (version !== undefined && release) {
        updateURL();
    }
    
    function stripDescriptions(obj: any): any {
        if (obj == null) return obj;
        if (Array.isArray(obj)) return obj.map(stripDescriptions);
        if (typeof obj === 'object') {
            const out: any = {};
            for (const k of Object.keys(obj)) {
                if (k === 'description') continue;
                out[k] = stripDescriptions(obj[k]);
            }
            return out;
        }
        return obj;
    }

    function restoreDescriptions(node: any, original: any, isRoot = false) {
        if (!node || typeof node !== 'object') return node;
        if (!original || typeof original !== 'object') return node;
        try {
            if (
                !isRoot &&
                'description' in original &&
                original.description &&
                !('description' in node)
            ) {
                node.description = original.description;
            }
        } catch (e) { }
        if (node.properties && original.properties) {
            for (const k of Object.keys(node.properties)) {
                try {
                    node.properties[k] = restoreDescriptions(
                        node.properties[k],
                        original.properties ? original.properties[k] : undefined,
                        false
                    );
                } catch (e) {
                    // ignore per-field
                }
            }
        }
        if (node.items && original.items) {
            node.items = restoreDescriptions(node.items, original.items, false);
        }
        return node;
    }

    function pruneSchema(node: any, re: RegExp | null, q: string): any | null {
        // Only match structural paths (property names / titles) by default.
        // Avoid matching descriptions, format, enum values, or other internal fields
        // unless a regex is explicitly provided that matches those values.
        if (node == null) return null;
        if (typeof node !== 'object' || (Array.isArray(node) === true && node.length === 0)) {
            // Do not match primitive leaf values by default (prevents matching enum values, formats, etc.)
            return null;
        }
        const out: any = {};
        let matched = false;
        function copyMeta(src: any, dst: any) {
            const keys = ['type', 'format', 'enum', 'default', 'minimum', 'maximum', 'pattern', 'title'];
            for (const k of keys) {
                if (k in src && src[k] !== undefined) dst[k] = src[k];
            }
        }
        if (node.properties && typeof node.properties === 'object') {
            const props: any = {};
            for (const [pname, pval] of Object.entries(node.properties)) {
                // First, check if the property name itself matches the query (normalize camelCase/underscores)
                let nameMatched = false;
                if (q) {
                    const normalizedName = String(pname)
                        .replace(/([a-z])([A-Z])/g, '$1 $2')
                        .replace(/[_.\-]/g, ' ')
                        .toLowerCase();
                    // Also consider a spaceless/compact form so queries like "maclimit"
                    // match camelCase names like "macLimit" (which normalize to "mac limit").
                    const normalizedNameNoSpace = normalizedName.replace(/\s+/g, '');
                    const qLower = q.toLowerCase();
                    const qNoSpace = qLower.replace(/[\s_.\-]/g, '');
                    if (normalizedName.includes(qLower) || normalizedNameNoSpace.includes(qNoSpace)) {
                        props[pname] = stripDescriptions(pval);
                        matched = true;
                        nameMatched = true;
                    }
                }

                // If name didn't match, recurse into the property's schema to find deeper property-name matches
                if (!nameMatched) {
                    const pr = pruneSchema(pval as any, re, q);
                    if (pr != null) {
                        props[pname] = pr;
                        matched = true;
                    }
                }
            }
            if (Object.keys(props).length > 0) {
                out.properties = props;
                if (node.type) out.type = node.type;
            }
        }
        if (node.items) {
            const pr = pruneSchema(node.items, re, q);
            if (pr != null) {
                out.items = pr;
                if (node.type) out.type = node.type;
                matched = true;
            }
        }
        for (const comb of ['allOf', 'anyOf', 'oneOf']) {
            if (Array.isArray(node[comb])) {
                const arr: any[] = [];
                for (const el of node[comb]) {
                    const pr = pruneSchema(el, re, q);
                    if (pr != null) {
                        arr.push(pr);
                        matched = true;
                    }
                }
                if (arr.length > 0) out[comb] = arr;
            }
        }
        if (node.additionalProperties && typeof node.additionalProperties === 'object') {
            const pr = pruneSchema(node.additionalProperties, re, q);
            if (pr != null) {
                out.additionalProperties = pr;
                matched = true;
            }
        }
        // Only consider 'title' as a scalar-key match target by default (titles are descriptive labels)
        const scalarKeys = ['title'];
        for (const k of scalarKeys) {
            if (k in node && node[k] !== undefined && q) {
                const s = String(node[k]);
                const sNorm = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.\-]/g, ' ').toLowerCase();
                const qLower = q.toLowerCase();
                const sNormNoSpace = sNorm.replace(/\s+/g, '');
                const qNoSpace = qLower.replace(/[\s_.\-]/g, '');
                if (sNorm.includes(qLower) || sNormNoSpace.includes(qNoSpace)) {
                    out[k] = node[k];
                    matched = true;
                }
            }
        }
        if (!matched) return null;
        copyMeta(node, out);
        return out;
    }

    function escapeHtml(s: string) {
        const entityMap: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return String(s ?? '').replace(/[&<>"']/g, (c) => entityMap[c] ?? c);
    }
    function escapeRegExp(s: string) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlightMatches(text: string, q: string) {
        const query = String(q ?? '').trim();
        if (!query) return escapeHtml(text);
        const hay = String(text || '');
        try {
            const re = new RegExp(query, 'ig');
            let lastIndex = 0;
            const parts: string[] = [];
            let match: RegExpExecArray | null;
            while ((match = re.exec(hay)) !== null) {
                const start = match.index;
                const end = re.lastIndex;
                parts.push(escapeHtml(hay.substring(lastIndex, start)));
                parts.push(
                    ` <mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(start, end))}</mark>`
                );
                lastIndex = end;
                if (re.lastIndex === match.index) re.lastIndex++;
            }
            parts.push(escapeHtml(hay.substring(lastIndex)));
            return parts.join('');
        } catch (e) {
            const idx = hay.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) return escapeHtml(hay);
            return `${escapeHtml(hay.substring(0, idx))}<mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(idx, idx + query.length))}</mark>${escapeHtml(hay.substring(idx + query.length))}`;
        }
    }

    async function performSearch() {
        results = [];
        if (!release || !query) return;
        loading = true;
        try {
            let manifest: any;
            if (manifestCache.has(release.folder)) {
                manifest = manifestCache.get(release.folder);
            } else {
                const resp = await fetch(`/${release.folder}/manifest.json`);
                if (!resp.ok) return;
                manifest = await resp.json();
                manifestCache.set(release.folder, manifest);
            }
            const q = String(query ?? '').trim();
            let re: RegExp | null = null;
            try { re = new RegExp(q, 'i'); } catch (e) { re = null; }
            const promises = manifest.flatMap(async (res: any) => {
                if (!res || !res.name) return [];
                if (String(res.name).toLowerCase().includes('states')) return [];
                const candidateVersions = version
                    ? [version]
                    : res.versions
                        ? res.versions.map((v: any) => v.name)
                        : [];
                const matches: Array<any> = [];
                for (const ver of candidateVersions) {
                    try {
                        const path = `/${release.folder}/${res.name}/${ver}.yaml`;
                        let txt: string | undefined = undefined;
                        if (yamlCache.has(path)) {
                            txt = yamlCache.get(path);
                        } else {
                            const r = await fetch(path);
                            if (!r.ok) continue;
                            txt = await r.text();
                            yamlCache.set(path, txt);
                        }
                        const parsed = yaml.load(txt) as any;
                        const spec = parsed?.schema?.openAPIV3Schema?.properties?.spec;
                        const status = parsed?.schema?.openAPIV3Schema?.properties?.status;

                        // Store full unfiltered schemas
                        const resourceKey = `${res.name}::${ver}`;
                        fullSchemas.set(resourceKey, {
                            spec: spec ? ensureRenderable(spec) : undefined,
                            status: status ? ensureRenderable(status) : undefined
                        });

                        if (spec) {
                            const stripped = stripDescriptions(spec);
                            const pruned = pruneSchema(stripped, re, q);
                            if (pruned) {
                                let readySchema = pruned;
                                try {
                                    if (
                                        (!pruned.properties || Object.keys(pruned.properties).length === 0) &&
                                        Array.isArray(pruned.required) &&
                                        stripped &&
                                        stripped.properties
                                    ) {
                                        const focusedProps: any = {};
                                        for (const rk of pruned.required) {
                                            if (rk in stripped.properties) focusedProps[rk] = stripped.properties[rk];
                                        }
                                        if (Object.keys(focusedProps).length > 0) {
                                            readySchema = {
                                                type: 'object',
                                                properties: focusedProps,
                                                required: pruned.required
                                            };
                                        }
                                    }
                                } catch (e) { readySchema = pruned; }
                                try { readySchema = restoreDescriptions(readySchema, spec, true); } catch (e) { }
                                const ready = ensureRenderable(readySchema);
                                matches.push({ name: res.name, kind: res.kind, schema: ready, version: ver, type: 'spec' });
                            }
                        }
                        if (status) {
                            const strippedStatus = stripDescriptions(status);
                            const prunedStatus = pruneSchema(strippedStatus, re, q);
                            if (prunedStatus) {
                                let readyStatus = prunedStatus;
                                try { readyStatus = restoreDescriptions(readyStatus, status, true); } catch (e) {}
                                const ensured = ensureRenderable(readyStatus);
                                matches.push({ name: res.name, kind: res.kind, schema: ensured, version: ver, type: 'status' });
                            }
                        }
                    } catch (e) {}
                }
                return matches;
            });
            const settled = await Promise.all(promises);
            results = settled.flat().filter(Boolean) as any;
        } finally { loading = false; }
    }

    function toggleToken(token: string) {
        const toks = query.split(/\s+/).filter(Boolean);
        if (toks.includes(token)) {
            query = toks.filter((t) => t !== token).join(' ');
        } else {
            toks.push(token);
            query = toks.join(' ');
        }
    }

    // schedule debounced search when user types
    function scheduleSearch() {
        if (debounceTimer) clearTimeout(debounceTimer);
        
        // Don't search without a release selected
        if (!release || !releaseName) {
            results = [];
            loading = false;
            return;
        }
        
        // If query is empty, clear results immediately
        if (!query || query.trim().length === 0) {
            results = [];
            loading = false;
            return;
        }
        
        // Update URL with current parameters
        updateURL();
        
        // Clear old results immediately when query changes to avoid showing stale data
        results = [];
        loading = true;
        
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            performSearch();
        }, 150); // Faster: reduced from 300ms to 150ms
    }

    // Watch query changes reactively to trigger search on any change (typing, clear button, etc.)
    let previousQuery = '';
    $: {
        // This reactive block re-runs whenever query changes
        if (query !== previousQuery) {
            previousQuery = query;
            scheduleSearch();
        }
    }

    // Global listener for YangView pathclick document events.
    // This covers any cases where YangView also emits `yang:pathclick` on document
    // (in addition to component-level `pathclick`). It toggles token selection
    // and schedules a search so results update automatically.
    let _yangHandler: any = null;
    if (typeof window !== 'undefined') {
        _yangHandler = (e: any) => {
            try {
                const token = (e?.detail?.displayPath || e?.detail?.path) as string;
                if (!token) return;
                const toks = query.split(/\s+/).filter(Boolean);
                if (toks.includes(token)) query = toks.filter((t: string) => t !== token).join(' ');
                else {
                    toks.push(token);
                    query = toks.join(' ');
                }
                // Immediately run search for a more responsive UX when user clicks YANG paths
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }
                performSearch();
            } catch (err) {
                /* ignore */
            }
        };
        document.addEventListener('yang:pathclick', _yangHandler);
    }
    onDestroy(() => {
        if (typeof window !== 'undefined' && _yangHandler) document.removeEventListener('yang:pathclick', _yangHandler);
    });
</script>

<svelte:head>
    <title>EDA Resource Browser | Interactive Path Search</title>
    </svelte:head>

<TopHeader title="Interactive Path Search" />

<div class="relative flex min-h-screen flex-col pt-12 md:pt-14">
    <div class="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        
        <!-- Compact Filters at Top -->
        <div class="mb-5 flex flex-wrap items-end gap-3">
            <div class="flex-1 min-w-[200px]">
                <label for="spec-release" class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Release
                </label>
                <select 
                    id="spec-release" 
                    bind:value={releaseName} 
                    on:change={loadVersions} 
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-all hover:border-gray-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:border-gray-500 dark:focus:border-cyan-400"
                >
                    <option value="">Select release...</option>
                    {#each releasesConfig.releases as r}
                        <option value={r.name}>{r.label}</option>
                    {/each}
                </select>
            </div>
            <div class="flex-1 min-w-[200px]">
                <label for="spec-version" class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Version
                </label>
                <select 
                    id="spec-version" 
                    bind:value={version} 
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-all hover:border-gray-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:border-gray-500 dark:focus:border-cyan-400" 
                    disabled={!release || versions.length === 0 || loadingVersions}
                >
                    <option value="">{loadingVersions ? 'Loading...' : 'All versions'}</option>
                    {#each versions as v}
                        <option value={v}>{v}</option>
                    {/each}
                </select>
            </div>
        </div>
        <!-- Enhanced Search Input -->
        <div class="mb-5 space-y-3">
            <div class="relative">
                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                    </svg>
                </div>
                <input
                    id="spec-query"
                    bind:value={query}
                    on:keydown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if (debounceTimer) {
                                clearTimeout(debounceTimer);
                                debounceTimer = null;
                            }
                            performSearch();
                        }
                    }}
                    placeholder="Type to search paths, or click paths below to build your query..."
                    class="w-full rounded-xl border border-gray-300 bg-white py-3.5 pl-11 pr-11 text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 hover:border-gray-400 focus:border-cyan-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/10 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-500 dark:focus:border-cyan-400"
                />
                {#if query}
                    <button 
                        type="button"
                        aria-label="Clear search" 
                        on:click|preventDefault|stopPropagation={() => { 
                            query = ''; 
                            previousQuery = '';
                            results = []; 
                            selectedResource = null;
                            selectedTokens = new Set();
                            updateURL();
                        }} 
                        class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                    >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                {/if}
            </div>

            <!-- Better Token/Path Display -->
            <div class="flex flex-wrap items-center justify-between gap-3">
                {#if query}
                    <div class="flex flex-wrap gap-2">
                        {#each query.split(/\s+/).filter(Boolean) as token}
                            <button
                                class="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-50 to-blue-50 px-3 py-1.5 text-xs font-medium text-cyan-700 shadow-sm transition-all hover:from-cyan-100 hover:to-blue-100 hover:shadow dark:from-cyan-900/30 dark:to-blue-900/30 dark:text-cyan-300 dark:hover:from-cyan-900/50 dark:hover:to-blue-900/50"
                                on:click={() => { 
                                    const toks = query.split(/\s+/).filter(Boolean); 
                                    query = toks.filter(t => t !== token).join(' '); 
                                }}
                            >
                                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                                <span class="font-mono">{token}</span>
                                <svg class="h-3.5 w-3.5 opacity-60 transition-opacity group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        {/each}
                    </div>
                {:else}
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                        <span class="hidden sm:inline">💡 Select a release and start typing, or click paths in results</span>
                        <span class="sm:hidden">💡 Click paths to search</span>
                    </div>
                {/if}
                
                {#if displayedResults.length > 0}
                    <div class="flex items-center gap-3">
                        <span class="text-sm font-medium text-gray-900 dark:text-gray-200">View:</span>
                        <button
                            on:click={() => (resultsViewMode = 'yang')}
                            class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors {resultsViewMode === 'yang'
                                ? 'bg-cyan-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
                        >YANG</button>
                        <button
                            on:click={() => (resultsViewMode = 'tree')}
                            class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors {resultsViewMode === 'tree'
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
                        >Tree</button>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-50 to-pink-50 px-3 py-1.5 shadow-sm dark:from-purple-900/30 dark:to-pink-900/30">
                            <svg class="h-4 w-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <span class="text-sm font-semibold text-purple-700 dark:text-purple-300">
                                {groupedResults.length} {groupedResults.length === 1 ? 'match' : 'matches'}
                            </span>
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Loading Indicator -->
        {#if loading}
            <div class="mb-5">
                <div class="flex items-center justify-center gap-3 rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-blue-50 px-4 py-3 dark:border-cyan-800 dark:from-cyan-900/20 dark:to-blue-900/20">
                    <div class="h-5 w-5 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600 dark:border-cyan-700 dark:border-t-cyan-400"></div>
                    <span class="text-sm font-medium text-cyan-700 dark:text-cyan-300">Searching...</span>
                </div>
            </div>
        {/if}

                <!-- Results Section -->
                {#if loading && query}
                    <!-- Loading Skeleton -->
                    <div class="space-y-4">
                        {#each [1, 2, 3] as _}
                            <div class="animate-pulse overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                                <div class="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-5 py-4 dark:border-gray-700 dark:from-gray-800 dark:to-gray-800">
                                    <div class="flex items-center justify-between gap-3">
                                        <div class="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700"></div>
                                        <div class="h-7 w-16 rounded-lg bg-gray-200 dark:bg-gray-700"></div>
                                    </div>
                                </div>
                                <div class="p-5">
                                    <div class="space-y-2">
                                        <div class="h-4 w-full rounded bg-gray-100 dark:bg-gray-700/50"></div>
                                        <div class="h-4 w-5/6 rounded bg-gray-100 dark:bg-gray-700/50"></div>
                                        <div class="h-4 w-4/6 rounded bg-gray-100 dark:bg-gray-700/50"></div>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if displayedResults.length > 0}
                    <div class="space-y-3 sm:hidden">
                        {#each groupedResults as g}
                            <button
                                type="button"
                                class="w-full text-left relative isolate z-0 overflow-hidden rounded-lg border border-gray-200 bg-white p-3 transition-all duration-200 hover:border-cyan-400 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:hover:border-cyan-500"
                                on:click|preventDefault|stopPropagation={(e) => {
                                    e.preventDefault();
                                    expandedPaths = [];
                                    const matchedPaths = new Set<string>();
                                    
                                    if (g.spec) {
                                        const specPaths = extractPaths(g.spec, 'spec');
                                        expandedPaths.push(...specPaths);
                                        specPaths.forEach(p => matchedPaths.add(p));
                                    }
                                    if (g.status) {
                                        const statusPaths = extractPaths(g.status, 'status');
                                        expandedPaths.push(...statusPaths);
                                        statusPaths.forEach(p => matchedPaths.add(p));
                                    }
                                    
                                    // Mark matching nodes in full schema for amber highlighting
                                    const markedFull = {
                                        spec: g.fullSpec ? markMatchingNodes(g.fullSpec, matchedPaths, 'spec') : g.fullSpec,
                                        status: g.fullStatus ? markMatchingNodes(g.fullStatus, matchedPaths, 'status') : g.fullStatus
                                    };
                                    
                                    modalExpandAll = false;
                                    modalData = { ...g, markedFull };
                                    isModalOpen = true;
                                }}
                            >
                                <div class="flex items-start justify-between gap-3">
                                    <div class="mr-2 min-w-0">
                                        <div class="text-sm font-semibold break-words text-gray-900 dark:text-white">
                                            {g.kind}
                                        </div>
                                        <div class="text-xs text-gray-600 dark:text-gray-300">
                                            {stripResourcePrefixFQDN(String(g.name))}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        {#if g.version}
                                            <div
                                                class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                                            >
                                                {g.version}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                                <div class="mt-3">
                                    <div
                                        class="text-xs break-words whitespace-normal text-gray-900 dark:text-gray-200"
                                    >
                                        <div class="overflow-x-auto">
                                            <div
                                                class="min-w-[960px] {g.spec && g.status
                                                    ? 'grid grid-cols-2 gap-4'
                                                    : 'grid grid-cols-1'}"
                                            >
                                                {#if g.spec}
                                                    <div>
                                                        <div
                                                            class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400"
                                                        >
                                                            SPEC
                                                        </div>
                                                        {#if resultsViewMode === 'tree'}
                                                            <div class="relative isolate overflow-hidden">
                                                                <div class="overflow-x-hidden">
                                                                    <Render
                                                                        hash={`${g.name}.${g.version}.spec`}
                                                                        source={release?.name || 'release'}
                                                                        type={'spec'}
                                                                        data={g.spec}
                                                                        showType={false}
                                                                    />
                                                                </div>
                                                            </div>
                                                        {:else}
                                                            <div class="relative isolate overflow-hidden">
                                                                <YangView
                                                                    hash={`${g.name}.${g.version}.spec`}
                                                                    source={release?.name || 'release'}
                                                                    type={'spec'}
                                                                    data={g.spec}
                                                                    resourceName={g.name}
                                                                    resourceVersion={g.version}
                                                                    {releaseName}
                                                                    kind={g.kind}
                                                                    clickToSearch={true}
                                                                    on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } performSearch(); }}
                                                                />
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/if}
                                                {#if g.status}
                                                    <div>
                                                        <div
                                                            class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400"
                                                        >
                                                            STATUS
                                                        </div>
                                                        {#if resultsViewMode === 'tree'}
                                                            <div class="relative isolate overflow-hidden">
                                                                <div class="overflow-x-hidden">
                                                                    <Render
                                                                        hash={`${g.name}.${g.version}.status`}
                                                                        source={release?.name || 'release'}
                                                                        type={'status'}
                                                                        data={g.status}
                                                                        showType={false}
                                                                    />
                                                                </div>
                                                            </div>
                                                        {:else}
                                                            <div class="relative isolate overflow-hidden">
                                                                <YangView
                                                                    hash={`${g.name}.${g.version}.status`}
                                                                    source={release?.name || 'release'}
                                                                    type={'status'}
                                                                    data={g.status}
                                                                    resourceName={g.name}
                                                                    resourceVersion={g.version}
                                                                    {releaseName}
                                                                    kind={g.kind}
                                                                    clickToSearch={true}
                                                                    on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } performSearch(); }}
                                                                />
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/if}
                                                {#if !g.spec && !g.status}
                                                    <div class="text-xs text-gray-500 dark:text-gray-400">
                                                        No matching content
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </button>
                        {/each}
                    </div>

                    <!-- Enhanced Desktop Table -->
                    <div class="hidden overflow-hidden rounded-xl border border-gray-200 shadow-md sm:block dark:border-gray-700">
                        <table class="w-full table-auto">
                            <thead>
                                <tr class="border-b border-gray-200 bg-gradient-to-r from-gray-50 via-white to-gray-50 dark:border-gray-700 dark:from-gray-800 dark:via-gray-800 dark:to-gray-800">
                                    <th class="px-5 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                        <div class="flex items-center gap-2">
                                            <svg class="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                            </svg>
                                            Resource
                                        </div>
                                    </th>
                                    <th class="px-5 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                        <div class="flex items-center gap-2">
                                            <svg class="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            Version
                                        </div>
                                    </th>
                                    <th class="px-5 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                        <div class="flex items-center gap-2">
                                            <svg class="h-4 w-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                            </svg>
                                            Schema
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100 bg-white dark:divide-gray-700/50 dark:bg-gray-800">
                                {#each groupedResults as g}
                                    <tr 
                                        class="cursor-pointer transition-all duration-200 hover:bg-gradient-to-r hover:from-cyan-50/50 hover:to-blue-50/50 dark:hover:from-cyan-900/10 dark:hover:to-blue-900/10"
                                        on:click|preventDefault|stopPropagation={(e) => {
                                            e.preventDefault();
                                            expandedPaths = [];
                                            const matchedPaths = new Set<string>();
                                            
                                            if (g.spec) {
                                                const specPaths = extractPaths(g.spec, 'spec');
                                                expandedPaths.push(...specPaths);
                                                specPaths.forEach(p => matchedPaths.add(p));
                                            }
                                            if (g.status) {
                                                const statusPaths = extractPaths(g.status, 'status');
                                                expandedPaths.push(...statusPaths);
                                                statusPaths.forEach(p => matchedPaths.add(p));
                                            }
                                            
                                            // Mark matching nodes in full schema for amber highlighting
                                            const markedFull = {
                                                spec: g.fullSpec ? markMatchingNodes(g.fullSpec, matchedPaths, 'spec') : g.fullSpec,
                                                status: g.fullStatus ? markMatchingNodes(g.fullStatus, matchedPaths, 'status') : g.fullStatus
                                            };
                                            
                                            modalExpandAll = false;
                                            modalData = { ...g, markedFull };
                                            isModalOpen = true;
                                        }}
                                    >
                                        <td class="relative isolate z-0 max-w-[40%] overflow-hidden px-3 py-3 font-medium break-words whitespace-pre-wrap text-gray-900 sm:px-6 sm:py-4 dark:text-white">
                                            <div class="flex items-start gap-2">
                                                <div class="min-w-0">
                                                    <div class="font-semibold">{g.kind}</div>
                                                    <div class="text-xs text-gray-500 dark:text-gray-300">{stripResourcePrefixFQDN(String(g.name))}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="relative isolate z-0 max-w-[12%] overflow-hidden px-3 py-3 break-words whitespace-pre-wrap text-gray-600 sm:px-6 sm:py-4 dark:text-gray-300">{g.version}</td>
                                        <td class="px-3 py-3 break-words whitespace-normal text-gray-900 sm:px-6 sm:py-4 dark:text-gray-200">
                                            <div class="pro-spec-preview relative isolate z-0 max-h-[40rem] overflow-hidden">
                                                <div class="overflow-x-auto">
                                                    <div class="min-w-[640px] space-y-4">
                                                        {#if g.spec}
                                                            <div>
                                                                <div class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400">SPEC</div>
                                                                {#if resultsViewMode === 'tree'}
                                                                    <div class="relative isolate overflow-hidden">
                                                                        <div class="overflow-x-hidden">
                                                                            <Render
                                                                                hash={`${g.name}.${g.version}.spec`}
                                                                                source={release?.name || 'release'}
                                                                                type={'spec'}
                                                                                data={g.spec}
                                                                                showType={false}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                {:else}
                                                                    <div class="relative isolate overflow-hidden">
                                                                        <YangView hash={`${g.name}.${g.version}.spec`} source={release?.name || 'release'} type={'spec'} data={g.spec} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } scheduleSearch(); }} />
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}
                                                        {#if g.status}
                                                            <div>
                                                                <div class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">STATUS</div>
                                                                {#if resultsViewMode === 'tree'}
                                                                    <div class="relative isolate overflow-hidden">
                                                                        <div class="overflow-x-hidden">
                                                                            <Render
                                                                                hash={`${g.name}.${g.version}.status`}
                                                                                source={release?.name || 'release'}
                                                                                type={'status'}
                                                                                data={g.status}
                                                                                showType={false}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                {:else}
                                                                    <div class="relative isolate overflow-hidden">
                                                                        <YangView hash={`${g.name}.${g.version}.status`} source={release?.name || 'release'} type={'status'} data={g.status} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } scheduleSearch(); }} />
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}
                                                        {#if !g.spec && !g.status}
                                                            <div class="text-xs text-gray-500 dark:text-gray-400">No matching content</div>
                                                        {/if}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {:else}
                    <div class="overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-gradient-to-br from-gray-50 via-white to-gray-50 shadow-sm dark:border-gray-700 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
                        <div class="px-6 py-12 text-center sm:py-16">
                            <div class="mx-auto flex max-w-md flex-col items-center gap-4">
                                <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 shadow-inner dark:from-gray-800 dark:to-gray-700">
                                    <svg class="h-8 w-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                                    </svg>
                                </div>
                                <div class="space-y-2">
                                    <h3 class="text-lg font-bold text-gray-900 dark:text-white">No Results Found</h3>
                                    <p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                                        {#if !release || !releaseName}
                                            Please select a release to begin searching.
                                        {:else if !query}
                                            Start typing to search across CRD schemas.
                                        {:else}
                                            No matches found for your query. Try different search terms.
                                        {/if}
                                    </p>
                                </div>
                                {#if query}
                                    <button 
                                        on:click={() => { query = ''; results = []; }}
                                        class="mt-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-cyan-600 hover:to-blue-700 hover:shadow focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    >
                                        Clear Search
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}

        <!-- Footer Credits -->
        <div class="mt-8">
            <PageCredits />
        </div>
    </div>
</div>

<!-- Modal for Resource Details -->
{#if isModalOpen && modalData}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div 
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        on:click|self={() => { isModalOpen = false; modalData = null; modalExpandAll = false; }}
        style="animation: fadeIn 0.2s ease-out;"
    >
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div 
            class="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            on:click|stopPropagation
            on:keydown={(e) => { if (e.key === 'Escape') { isModalOpen = false; modalData = null; modalExpandAll = false; } }}
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            style="animation: slideUp 0.3s ease-out;"
        >
            <!-- Modal Header -->
            <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 dark:border-gray-700 dark:from-slate-900 dark:to-slate-800">
                <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg">
                        <svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold text-white">{modalData.kind}</h2>
                        <p class="text-sm text-cyan-300">{stripResourcePrefixFQDN(String(modalData.name))}</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    {#if version}
                        <span class="rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 px-3 py-1 text-sm font-mono font-semibold text-cyan-300">
                            v{version}
                        </span>
                    {/if}
                    <button
                        on:click={() => { modalExpandAll = !modalExpandAll; }}
                        class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:from-purple-700 hover:to-indigo-700 hover:shadow-lg"
                    >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {#if modalExpandAll}
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
                            {:else}
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                            {/if}
                        </svg>
                        {modalExpandAll ? 'Collapse All' : 'Expand All'}
                    </button>
                    <button
                        on:click={() => { isModalOpen = false; modalData = null; modalExpandAll = false; }}
                        class="rounded-lg p-2 text-gray-400 transition-all hover:bg-white/10 hover:text-white"
                        aria-label="Close modal"
                    >
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Modal Body -->
            <div class="overflow-y-auto bg-slate-50 p-6 dark:bg-slate-900" style="max-height: calc(90vh - 80px);">
                <div class="space-y-6">
                    {#if modalData.fullSpec}
                        <div class="rounded-xl border-2 border-cyan-200 bg-white shadow-sm dark:border-cyan-800/50 dark:bg-slate-800">
                            <div class="border-b border-cyan-100 bg-gradient-to-r from-cyan-50 to-blue-50 px-5 py-3 dark:border-cyan-900/50 dark:from-cyan-950/30 dark:to-blue-950/30">
                                <div class="flex items-center gap-3">
                                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600">
                                        <svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-bold text-cyan-900 dark:text-cyan-100">Spec Schema</h3>
                                        <p class="text-xs text-cyan-700 dark:text-cyan-400">Resource specification and configuration</p>
                                    </div>
                                </div>
                            </div>
                            <div class="p-5">
                                {#key modalExpandAll}
                                    <Render
                                        hash={expandedPaths.join('|')}
                                        source={release?.name || 'release'}
                                        type={'spec'}
                                        data={modalData.markedFull?.spec || modalData.fullSpec}
                                        showType={false}
                                        showDiffIndicator={true}
                                        forceExpandAll={modalExpandAll}
                                    />
                                {/key}
                            </div>
                        </div>
                    {/if}
                    {#if modalData.fullStatus}
                        <div class="rounded-xl border-2 border-green-200 bg-white shadow-sm dark:border-green-800/50 dark:bg-slate-800">
                            <div class="border-b border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 px-5 py-3 dark:border-green-900/50 dark:from-green-950/30 dark:to-emerald-950/30">
                                <div class="flex items-center gap-3">
                                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
                                        <svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 class="text-base font-bold text-green-900 dark:text-green-100">Status Schema</h3>
                                        <p class="text-xs text-green-700 dark:text-green-400">Observed state and runtime information</p>
                                    </div>
                                </div>
                            </div>
                            <div class="p-5">
                                {#key modalExpandAll}
                                    <Render
                                        hash={expandedPaths.join('|')}
                                        source={release?.name || 'release'}
                                        type={'status'}
                                        data={modalData.markedFull?.status || modalData.fullStatus}
                                        showType={false}
                                        showDiffIndicator={true}
                                        forceExpandAll={modalExpandAll}
                                    />
                                {/key}
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes slideUp {
        from { 
            opacity: 0;
            transform: translateY(20px) scale(0.95);
        }
        to { 
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
