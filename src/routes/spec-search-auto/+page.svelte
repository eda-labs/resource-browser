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
    let searchInDescription = false;
    let selectedTokens = new Set<string>();
    let selectedResource: string | null = null;
    let isModalOpen = false;
    let modalData: { name: string; kind?: string; version?: string; spec?: any; status?: any; fullSpec?: any; fullStatus?: any; markedFull?: { spec?: any; status?: any } } | null = null;
    let expandedPaths: string[] = [];
    let modalExpandAll = false;

    // Extract all property paths from a schema object to determine what should be expanded
    function extractPaths(obj: any, prefix: string = '', paths: any[] = []): any[] {
        if (!obj || typeof obj !== 'object') return paths;
        
        if (obj.properties) {
            for (const key of Object.keys(obj.properties)) {
                const path = prefix ? `${prefix}.${key}` : key;
                const prop = obj.properties[key];
                
                // A node is a leaf if it has NO nested properties AND NO items (array children)
                const hasNestedProperties = prop.properties && Object.keys(prop.properties).length > 0;
                const hasArrayItems = prop.items && (prop.items.properties || prop.items.items);
                const isLeaf = !hasNestedProperties && !hasArrayItems;
                
                if (isLeaf) {
                    const pathInfo: any = { path };
                    
                    // Add type info
                    if (prop.type) pathInfo.type = prop.type;
                    
                    // Add enum if present
                    if (prop.enum && Array.isArray(prop.enum)) pathInfo.enum = prop.enum;
                    
                    // Add default value if present
                    if (prop.default !== undefined) pathInfo.default = prop.default;
                    
                    // Add constraints
                    const constraints: string[] = [];
                    if (prop.minimum !== undefined) constraints.push(`min: ${prop.minimum}`);
                    if (prop.maximum !== undefined) constraints.push(`max: ${prop.maximum}`);
                    if (prop.minLength !== undefined) constraints.push(`minLen: ${prop.minLength}`);
                    if (prop.maxLength !== undefined) constraints.push(`maxLen: ${prop.maxLength}`);
                    if (prop.pattern) constraints.push(`pattern: ${prop.pattern}`);
                    if (constraints.length > 0) pathInfo.constraints = constraints;
                    
                    paths.push(pathInfo);
                }
                
                // Always recurse to find nested leaves
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

    // Initialize from URL parameters only once on mount
    let initialized = false;
    $: {
        if (!initialized) {
            const urlRelease = $page.url.searchParams.get('release');
            const urlVersion = $page.url.searchParams.get('version');
            const urlQuery = $page.url.searchParams.get('q');
            
            if (urlRelease) {
                releaseName = urlRelease;
                loadVersions();
            }
            if (urlVersion) {
                version = urlVersion;
            }
            if (urlQuery) {
                query = urlQuery;
            }
            initialized = true;
        }
    }

    // Update URL when parameters change
    function updateURL() {
        const params = new URLSearchParams();
        if (releaseName) params.set('release', releaseName);
        if (version) params.set('version', version);
        if (query && query.trim()) params.set('q', query);
        
        const targetUrl = `/spec-search-auto${params.toString() ? `?${params.toString()}` : ''}`;
        
        // Always update to ensure URL reflects current state
        goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
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
    const MAX_RESULTS = 100; // Limit results for performance
    $: displayedResults = results.slice(0, MAX_RESULTS);

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

    function pruneSchema(node: any, re: RegExp | null, q: string, includeDesc: boolean = false): any | null {
        // Only match structural paths (property names / titles) by default.
        // Optionally include descriptions if includeDesc is true.
        if (node == null) return null;
        if (typeof node !== 'object' || (Array.isArray(node) === true && node.length === 0)) {
            // Do not match primitive leaf values by default (prevents matching enum values, formats, etc.)
            return null;
        }
        const out: any = {};
        let matched = false;
        function copyMeta(src: any, dst: any) {
            const keys = ['type', 'format', 'enum', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'title'];
            for (const k of keys) {
                if (k in src && src[k] !== undefined) dst[k] = src[k];
            }
        }
        
        // Check if description matches (if includeDesc is true)
        if (includeDesc && node.description && typeof node.description === 'string' && q) {
            const descLower = node.description.toLowerCase();
            const qLower = q.toLowerCase();
            if (descLower.includes(qLower)) {
                matched = true;
                copyMeta(node, out);
                if (node.description) out.description = node.description;
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
                    const pr = pruneSchema(pval as any, re, q, includeDesc);
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
            const pr = pruneSchema(node.items, re, q, includeDesc);
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
                    const pr = pruneSchema(el, re, q, includeDesc);
                    if (pr != null) {
                        arr.push(pr);
                        matched = true;
                    }
                }
                if (arr.length > 0) out[comb] = arr;
            }
        }
        if (node.additionalProperties && typeof node.additionalProperties === 'object') {
            const pr = pruneSchema(node.additionalProperties, re, q, includeDesc);
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
                            const stripped = searchInDescription ? spec : stripDescriptions(spec);
                            const pruned = pruneSchema(stripped, re, q, searchInDescription);
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
                            const strippedStatus = searchInDescription ? status : stripDescriptions(status);
                            const prunedStatus = pruneSchema(strippedStatus, re, q, searchInDescription);
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
            updateURL(); // Update URL to remove query parameter
            return;
        }
        
        // Clear old results immediately when query changes to avoid showing stale data
        results = [];
        loading = true;
        
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            performSearch();
            updateURL(); // Update URL after search is triggered
        }, 100); // Ultra-fast: reduced to 100ms for instant feel
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

    // Trigger search when searchInDescription toggle changes
    let previousSearchInDescription = false;
    $: {
        if (searchInDescription !== previousSearchInDescription && query) {
            previousSearchInDescription = searchInDescription;
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
    <title>EDA Resource Browser | Resource Search</title>
</svelte:head><TopHeader title="Resource Search" />

<div class="relative flex min-h-screen flex-col pt-12 md:pt-14">
    <div class="mx-auto w-full max-w-7xl flex-1 px-3 py-3 sm:px-4 sm:py-4">
        
        <!-- Ultra-Compact Filters -->
        <div class="mb-4 flex flex-wrap items-center gap-2">
            <select 
                id="spec-release" 
                bind:value={releaseName} 
                on:change={loadVersions} 
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:border-gray-500 dark:focus:border-cyan-400"
            >
                <option value="">Select release...</option>
                {#each releasesConfig.releases as r}
                    <option value={r.name}>{r.label}</option>
                {/each}
            </select>
            
            <select 
                id="spec-version" 
                bind:value={version}
                on:change={() => {
                    updateURL();
                    if (query && query.trim()) {
                        scheduleSearch();
                    }
                }}
                class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:border-gray-500 dark:focus:border-cyan-400" 
                disabled={!release || versions.length === 0 || loadingVersions}
            >
                <option value="">{loadingVersions ? 'Loading...' : 'All versions'}</option>
                {#each versions as v}
                    <option value={v}>{v}</option>
                {/each}
            </select>
            
            <label class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-all hover:border-cyan-400 dark:border-gray-600 dark:bg-gray-800">
                <input 
                    type="checkbox" 
                    bind:checked={searchInDescription}
                    class="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-700"
                />
                <span class="text-gray-700 dark:text-gray-300">Search descriptions</span>
            </label>
            
            {#if groupedResults.length > 0}
                <div class="ml-auto text-xs text-gray-500 dark:text-gray-400">
                    {groupedResults.length} resource{groupedResults.length !== 1 ? 's' : ''} found
                    {#if results.length > MAX_RESULTS}
                        <span class="text-amber-600 dark:text-amber-400">(showing first {MAX_RESULTS})</span>
                    {/if}
                </div>
            {/if}
        </div>

        <!-- Compact Search Input -->
        <div class="mb-4">
            <div class="relative">
                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    placeholder="Search property paths..."
                    class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-500 dark:focus:border-cyan-400"
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
                        class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                {/if}
            </div>
        </div>

        <!-- Loading Indicator -->
        {#if loading}
            <div class="mb-4">
                <div class="flex items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 dark:border-cyan-800 dark:bg-cyan-900/20">
                    <div class="h-4 w-4 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600 dark:border-cyan-700 dark:border-t-cyan-400"></div>
                    <span class="text-sm font-medium text-cyan-700 dark:text-cyan-300">Searching...</span>
                </div>
            </div>
        {/if}

        <!-- Results Section -->
        {#if loading}
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
                    <!-- Mobile Cards -->
                    <div class="space-y-2 sm:hidden">
                        {#each groupedResults as g}
                            <button
                                on:click={(e) => {
                                    e.preventDefault();
                                    expandedPaths = [];
                                    const matchedPaths = new Set<string>();
                                    
                                    if (g.spec) {
                                        const specPaths = extractPaths(g.spec, 'spec');
                                        expandedPaths.push(...specPaths.map(p => typeof p === 'string' ? p : p.path));
                                        specPaths.forEach(p => matchedPaths.add(typeof p === 'string' ? p : p.path));
                                    }
                                    if (g.status) {
                                        const statusPaths = extractPaths(g.status, 'status');
                                        expandedPaths.push(...statusPaths.map(p => typeof p === 'string' ? p : p.path));
                                        statusPaths.forEach(p => matchedPaths.add(typeof p === 'string' ? p : p.path));
                                    }
                                    
                                    const markedFull = {
                                        spec: g.fullSpec ? markMatchingNodes(g.fullSpec, matchedPaths, 'spec') : g.fullSpec,
                                        status: g.fullStatus ? markMatchingNodes(g.fullStatus, matchedPaths, 'status') : g.fullStatus
                                    };
                                    
                                    modalExpandAll = false;
                                    modalData = { ...g, markedFull };
                                    isModalOpen = true;
                                }}
                                class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-colors hover:border-cyan-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-cyan-600 dark:hover:bg-gray-700/50">
                                <div class="p-3">
                                    <div class="mb-2 flex items-start justify-between gap-2">
                                        <div class="flex-1 min-w-0">
                                            <div class="text-sm font-semibold text-gray-900 dark:text-white">{g.kind}</div>
                                            <div class="text-xs text-gray-500 dark:text-gray-400">{stripResourcePrefixFQDN(String(g.name))}</div>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            {#if g.version}
                                                <span class="rounded px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{g.version}</span>
                                            {/if}
                                        </div>
                                    </div>
                                    <!-- Schema badges and paths -->
                                    <div class="space-y-1.5">
                                        {#if g.spec}
                                            {@const paths = extractPaths(g.spec, 'spec')}
                                            <div>
                                                <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                                                    Spec
                                                </span>
                                                <div class="mt-1 flex flex-wrap gap-1">
                                                    {#each paths as pathInfo}
                                                        <span class="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                            {typeof pathInfo === 'string' ? pathInfo : pathInfo.path}
                                                        </span>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                        {#if g.status}
                                            {@const paths = extractPaths(g.status, 'status')}
                                            <div>
                                                <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                                    Status
                                                </span>
                                                <div class="mt-1 flex flex-wrap gap-1">
                                                    {#each paths as pathInfo}
                                                        <span class="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                            {typeof pathInfo === 'string' ? pathInfo : pathInfo.path}
                                                        </span>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            </button>
                        {/each}
                    </div>

                    <!-- Compact Professional Desktop Table -->
                    <div class="hidden overflow-hidden rounded-lg border border-gray-200 shadow-sm sm:block dark:border-gray-700">
                        <table class="w-full">
                            <thead class="bg-gray-50 dark:bg-gray-900">
                                <tr class="border-b border-gray-200 dark:border-gray-700">
                                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Resource
                                    </th>
                                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Version
                                    </th>
                                    <th class="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        Matched Paths
                                    </th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100 bg-white dark:divide-gray-700/50 dark:bg-gray-800">
                                {#each groupedResults as g, idx}
                                    <tr
                                        on:click={(e) => {
                                            e.preventDefault();
                                            expandedPaths = [];
                                            const matchedPaths = new Set<string>();
                                            
                                            if (g.spec) {
                                                const specPaths = extractPaths(g.spec, 'spec');
                                                expandedPaths.push(...specPaths.map(p => typeof p === 'string' ? p : p.path));
                                                specPaths.forEach(p => matchedPaths.add(typeof p === 'string' ? p : p.path));
                                            }
                                            if (g.status) {
                                                const statusPaths = extractPaths(g.status, 'status');
                                                expandedPaths.push(...statusPaths.map(p => typeof p === 'string' ? p : p.path));
                                                statusPaths.forEach(p => matchedPaths.add(typeof p === 'string' ? p : p.path));
                                            }
                                            
                                            const markedFull = {
                                                spec: g.fullSpec ? markMatchingNodes(g.fullSpec, matchedPaths, 'spec') : g.fullSpec,
                                                status: g.fullStatus ? markMatchingNodes(g.fullStatus, matchedPaths, 'status') : g.fullStatus
                                            };
                                            
                                            modalExpandAll = false;
                                            modalData = { ...g, markedFull };
                                            isModalOpen = true;
                                        }}
                                        class="cursor-pointer transition-colors {idx % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-900/20'} hover:bg-cyan-50 dark:hover:bg-cyan-900/20"
                                    >
                                        <td class="px-4 py-2.5">
                                            <div class="flex flex-col gap-0.5">
                                                <div class="text-sm font-semibold text-gray-900 dark:text-white">{g.kind}</div>
                                                <div class="text-xs text-gray-500 dark:text-gray-400">{stripResourcePrefixFQDN(String(g.name))}</div>
                                            </div>
                                        </td>
                                        <td class="px-4 py-2.5">
                                            {#if g.version}
                                                <span class="inline-flex rounded px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{g.version}</span>
                                            {/if}
                                        </td>
                                        <td class="px-4 py-2.5">
                                            <div class="space-y-1.5">
                                                {#if g.spec}
                                                    {@const paths = extractPaths(g.spec, 'spec')}
                                                    {#if paths.length > 0}
                                                        <div class="rounded border border-cyan-200 bg-cyan-50/30 p-1.5 dark:border-cyan-800 dark:bg-cyan-900/20">
                                                            <div class="mb-1 text-xs font-semibold text-cyan-700 dark:text-cyan-400">Spec</div>
                                                            <div class="space-y-0.5">
                                                                {#each paths as pathInfo}
                                                                    <div class="group relative flex items-center gap-1.5 flex-wrap">
                                                                        <span class="text-xs font-mono text-amber-700 dark:text-amber-300">{typeof pathInfo === 'string' ? pathInfo : pathInfo.path}</span>
                                                                        {#if typeof pathInfo === 'object' && pathInfo.type}
                                                                            {@const typeColors = {
                                                                                string: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
                                                                                integer: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
                                                                                number: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
                                                                                boolean: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
                                                                                object: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
                                                                                array: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800'
                                                                            }}
                                                                            {@const typeColor = typeColors[pathInfo.type as keyof typeof typeColors] || 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
                                                                            <span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium {typeColor}">{pathInfo.type}</span>
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.enum}
                                                                            {#each pathInfo.enum.slice(0, 3) as e}
                                                                                <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{e}</span>
                                                                            {/each}
                                                                            {#if pathInfo.enum.length > 3}
                                                                                <span class="text-[10px] text-purple-500 dark:text-purple-400">+{pathInfo.enum.length - 3} more</span>
                                                                            {/if}
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.default !== undefined}
                                                                            <span class="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">default: {JSON.stringify(pathInfo.default)}</span>
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.constraints}
                                                                            {#each pathInfo.constraints as constraint}
                                                                                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">{constraint}</span>
                                                                            {/each}
                                                                        {/if}
                                                                        
                                                                        <!-- Hover tooltip with all metadata grouped -->
                                                                        {#if typeof pathInfo === 'object' && (pathInfo.enum || pathInfo.default !== undefined || pathInfo.constraints)}
                                                                            <div class="pointer-events-none absolute left-0 top-full z-[100] mt-1 hidden group-hover:block">
                                                                                <div class="w-max max-w-md rounded-lg border border-gray-300 bg-white p-2.5 shadow-xl dark:border-gray-600 dark:bg-gray-800">
                                                                                    <div class="space-y-2">
                                                                                        {#if pathInfo.enum}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Enum Values</div>
                                                                                                <div class="flex flex-wrap gap-1">
                                                                                                    {#each pathInfo.enum as e}
                                                                                                        <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{e}</span>
                                                                                                    {/each}
                                                                                                </div>
                                                                                            </div>
                                                                                        {/if}
                                                                                        {#if pathInfo.default !== undefined}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Default Value</div>
                                                                                                <span class="inline-block rounded bg-indigo-100 px-2 py-1 text-xs font-mono text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{JSON.stringify(pathInfo.default)}</span>
                                                                                            </div>
                                                                                        {/if}
                                                                                        {#if pathInfo.constraints}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">Constraints</div>
                                                                                                <div class="flex flex-wrap gap-1">
                                                                                                    {#each pathInfo.constraints as constraint}
                                                                                                        <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">{constraint}</span>
                                                                                                    {/each}
                                                                                                </div>
                                                                                            </div>
                                                                                        {/if}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        {/if}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    {/if}
                                                {/if}
                                                {#if g.status}
                                                    {@const paths = extractPaths(g.status, 'status')}
                                                    {#if paths.length > 0}
                                                        <div class="rounded border border-green-200 bg-green-50/30 p-1.5 dark:border-green-800 dark:bg-green-900/20">
                                                            <div class="mb-1 text-xs font-semibold text-green-700 dark:text-green-400">Status</div>
                                                            <div class="space-y-0.5">
                                                                {#each paths as pathInfo}
                                                                    <div class="group relative flex items-center gap-1.5 flex-wrap">
                                                                        <span class="text-xs font-mono text-amber-700 dark:text-amber-300">{typeof pathInfo === 'string' ? pathInfo : pathInfo.path}</span>
                                                                        {#if typeof pathInfo === 'object' && pathInfo.type}
                                                                            {@const typeColors = {
                                                                                string: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
                                                                                integer: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
                                                                                number: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
                                                                                boolean: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
                                                                                object: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
                                                                                array: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800'
                                                                            }}
                                                                            {@const typeColor = typeColors[pathInfo.type as keyof typeof typeColors] || 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
                                                                            <span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium {typeColor}">{pathInfo.type}</span>
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.enum}
                                                                            {#each pathInfo.enum.slice(0, 3) as e}
                                                                                <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{e}</span>
                                                                            {/each}
                                                                            {#if pathInfo.enum.length > 3}
                                                                                <span class="text-[10px] text-purple-500 dark:text-purple-400">+{pathInfo.enum.length - 3} more</span>
                                                                            {/if}
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.default !== undefined}
                                                                            <span class="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">default: {JSON.stringify(pathInfo.default)}</span>
                                                                        {/if}
                                                                        {#if typeof pathInfo === 'object' && pathInfo.constraints}
                                                                            {#each pathInfo.constraints as constraint}
                                                                                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">{constraint}</span>
                                                                            {/each}
                                                                        {/if}
                                                                        
                                                                        <!-- Hover tooltip with all metadata grouped -->
                                                                        {#if typeof pathInfo === 'object' && (pathInfo.enum || pathInfo.default !== undefined || pathInfo.constraints)}
                                                                            <div class="pointer-events-none absolute left-0 top-full z-[100] mt-1 hidden group-hover:block">
                                                                                <div class="w-max max-w-md rounded-lg border border-gray-300 bg-white p-2.5 shadow-xl dark:border-gray-600 dark:bg-gray-800">
                                                                                    <div class="space-y-2">
                                                                                        {#if pathInfo.enum}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Enum Values</div>
                                                                                                <div class="flex flex-wrap gap-1">
                                                                                                    {#each pathInfo.enum as e}
                                                                                                        <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{e}</span>
                                                                                                    {/each}
                                                                                                </div>
                                                                                            </div>
                                                                                        {/if}
                                                                                        {#if pathInfo.default !== undefined}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Default Value</div>
                                                                                                <span class="inline-block rounded bg-indigo-100 px-2 py-1 text-xs font-mono text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{JSON.stringify(pathInfo.default)}</span>
                                                                                            </div>
                                                                                        {/if}
                                                                                        {#if pathInfo.constraints}
                                                                                            <div>
                                                                                                <div class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">Constraints</div>
                                                                                                <div class="flex flex-wrap gap-1">
                                                                                                    {#each pathInfo.constraints as constraint}
                                                                                                        <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">{constraint}</span>
                                                                                                    {/each}
                                                                                                </div>
                                                                                            </div>
                                                                                        {/if}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        {/if}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    {/if}
                                                {/if}
                                                {#if !g.spec && !g.status}
                                                    <span class="text-xs text-gray-400 dark:text-gray-500">—</span>
                                                {/if}
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
                            {version}
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
