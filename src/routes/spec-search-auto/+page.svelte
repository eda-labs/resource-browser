<script lang="ts">
    import yaml from 'js-yaml';
    import { onMount, onDestroy } from 'svelte';
    // AnimatedBackground is dynamically imported/rendered by the layout; avoid importing here to keep it lazy
    import TopHeader from '$lib/components/TopHeader.svelte';
    import PageCredits from '$lib/components/PageCredits.svelte';

    // Render not used - YANG-only view for auto search; keep import removed to avoid unused import
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

    type GroupedResult = { name: string; kind?: string; version?: string; spec?: any; status?: any };
    let groupedResults: GroupedResult[] = [];
    $: groupedResults = (() => {
        const map = new Map<string, GroupedResult>();
        for (const r of displayedResults) {
            const key = `${r.name}::${r.version || ''}`;
            if (!map.has(key))
                map.set(key, {
                    name: r.name,
                    kind: r.kind,
                    version: r.version,
                    spec: undefined,
                    status: undefined
                });
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
        } catch (e) {
            versions = [];
            version = '';
        } finally {
            loadingVersions = false;
        }
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
        
        // If query is empty, clear results immediately
        if (!query || query.trim().length === 0) {
            results = [];
            loading = false;
            return;
        }
        
        // Clear old results immediately when query changes to avoid showing stale data
        results = [];
        loading = true;
        
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            performSearch();
        }, 300);
    }

    // Watch query changes reactively to trigger search on any change (typing, clear button, etc.)
    $: {
        // This reactive block re-runs whenever query changes
        void query; // reference query to make it reactive
        scheduleSearch();
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
    <title>EDA Resource Browser | Search CRD Specs (Auto)</title>
    </svelte:head>

<TopHeader title="Search CRD Specs & Status (Auto)" />

<div class="mx-auto max-w-7xl px-4 py-2"></div>

<div class="relative flex flex-col overflow-y-auto pt-12 md:pt-14 lg:min-h-screen lg:overflow-hidden">
    <div class="relative z-10 flex flex-1 flex-col lg:flex-row">
        <div class="flex-1 overflow-auto pb-16">
            <div class="mx-auto max-w-7xl px-4 py-4">
                <div class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"></div>
                <div class="space-y-2 sm:space-y-4">
                    <div>
                        <p class="mb-2 text-sm leading-relaxed text-white sm:text-base">Select a release and version (leave the version blank to search all versions), then search inside CRD spec and status schemas. Descriptions are ignored to focus matches on parameters and values.</p>
                        <label for="spec-release" class="mb-1 block text-base font-semibold text-gray-900 sm:mb-2 sm:text-lg dark:text-white">Release & Version</label>
                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
                            <div class="relative">
                                <select id="spec-release" aria-label="Select release" bind:value={releaseName} on:change={loadVersions} class="w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500 sm:px-4 sm:py-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white" style="z-index:1000;">
                                    <option value="">Select release...</option>
                                    {#each releasesConfig.releases as r}
                                        <option value={r.name}>{r.label}</option>
                                    {/each}
                                </select>
                            </div>
                            <div class="relative">
                                <select id="spec-version" aria-label="Select resource version" bind:value={version} class="w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:py-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white" style="z-index:1000;" disabled={!release || versions.length === 0 || loadingVersions}>
                                    <option value="">{loadingVersions ? 'Loading versions...' : 'All versions'}</option>
                                    {#each versions as v}
                                        <option value={v}>{v}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                        <div class="relative pt-2"></div>
                    </div>
                </div>
                <div class="mb-2">
                    <div class="flex items-center gap-3">
                        <div class="relative flex-1">
                            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
                            </div>
                            <input
                                id="spec-query"
                                bind:value={query}
                                on:input={() => {
                                    scheduleSearch();
                                    selectedTokens = new Set(query.split(/\s+/).filter(Boolean));
                                }}
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
                                placeholder="Search in real-time (regex or tokens)..."
                                class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-10 pl-9 text-sm text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                            {#if query}
                                <button aria-label="Clear search" on:click={() => { query = ''; results = []; }} class="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-gray-100 p-1 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            {/if}
                        </div>
                        <!-- Expand All removed for auto-search page -->
                        <div class="flex items-center gap-3"></div>
                        <div class="text-sm text-gray-500 dark:text-gray-400">{groupedResults.length} matches</div>
                        <div class="ml-3 flex items-center gap-2"> 
                            <!-- View toggles intentionally removed; only YANG view is supported in this auto-search page -->
                        </div>
                    </div>
                    <!-- Selected tokens / chips -->
                    {#if query}
                        <div class="mt-2 flex flex-wrap gap-2">
                            {#each query.split(/\s+/).filter(Boolean) as token}
                                <div class="inline-flex items-center gap-2 rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                    <span class="font-mono">{token}</span>
                                    <button class="ml-1 rounded px-1" on:click={() => { const toks = query.split(/\s+/).filter(Boolean); const newt = toks.filter(t => t !== token); query = newt.join(' '); if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } performSearch(); }}>{'✕'}</button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div class="relative border-t border-gray-200 pt-4">{#if loading}<div class="pointer-events-none absolute -top-1 right-0 left-0 h-1"><div class="h-1 w-full bg-gray-200 dark:bg-gray-700"><div class="h-1 rounded-full bg-purple-600" style="width: 100%"></div></div></div>{/if}</div>

                <!-- Results (the rest is identical to spec-search, but YangView uses clickToSearch and on:pathclick handlers) -->
                {#if displayedResults.length > 0}
                    <div class="space-y-3 sm:hidden">
                        {#each groupedResults as g}
                            <div class="relative isolate z-0 overflow-hidden rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="mr-2 min-w-0">
                                        <div class="text-sm font-semibold break-words text-gray-900 dark:text-white">{g.kind}</div>
                                        <div class="text-xs text-gray-600 dark:text-gray-300">{stripResourcePrefixFQDN(String(g.name))}</div>
                                    </div>
                                    <div class="flex items-center gap-2">{#if g.version}<div class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">{g.version}</div>{/if}</div>
                                </div>
                                <div class="mt-3">
                                    <div class="text-xs break-words whitespace-normal text-gray-900 dark:text-gray-200"><div class="overflow-x-auto"><div class="min-w-[640px] {g.spec && g.status ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-1'}">
                                        {#if g.spec}
                                            <div>
                                                <div class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400">SPEC</div>
                                                    <div class="relative isolate overflow-hidden"><YangView hash={`${g.name}.${g.version}.spec`} source={release?.name || 'release'} type={'spec'} data={g.spec} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } performSearch(); }} /></div>
                                            </div>
                                        {/if}
                                        {#if g.status}
                                            <div>
                                                <div class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">STATUS</div>
                                                    <div class="relative isolate overflow-hidden"><YangView hash={`${g.name}.${g.version}.status`} source={release?.name || 'release'} type={'status'} data={g.status} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } performSearch(); }} /></div>
                                            </div>
                                        {/if}
                                        {#if !g.spec && !g.status}
                                            <div class="text-xs text-gray-500 dark:text-gray-400">No matching content</div>
                                        {/if}
                                    </div></div></div>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <div class="hidden overflow-x-auto rounded-lg border border-gray-200 shadow-sm sm:block sm:rounded-xl dark:border-gray-700">
                        <table class="w-full table-auto text-xs sm:text-sm">
                            <thead class="bg-gray-50 dark:bg-gray-900"><tr><th class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white">Resource</th><th class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white">Version</th><th class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white">Match</th></tr></thead>
                            <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                                {#each groupedResults as g}
                                    <tr class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td class="relative isolate z-0 max-w-[40%] overflow-hidden px-3 py-3 font-medium break-words whitespace-pre-wrap text-gray-900 sm:px-6 sm:py-4 dark:text-white"><div class="font-semibold">{g.kind}</div><div class="text-xs text-gray-500 dark:text-gray-300">{stripResourcePrefixFQDN(String(g.name))}</div></td>
                                        <td class="relative isolate z-0 max-w-[12%] overflow-hidden px-3 py-3 break-words whitespace-pre-wrap text-gray-600 sm:px-6 sm:py-4 dark:text-gray-300">{g.version}</td>
                                        <td class="px-3 py-3 break-words whitespace-normal text-gray-900 sm:px-6 sm:py-4 dark:text-gray-200">
                                            <div class="pro-spec-preview relative isolate z-0 max-h-[40rem] overflow-hidden"><div class="overflow-x-auto"><div class="min-w-[640px] space-y-4">
                                                {#if g.spec}
                                                    <div><div class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400">SPEC</div><div class="relative isolate overflow-hidden"><YangView hash={`${g.name}.${g.version}.spec`} source={release?.name || 'release'} type={'spec'} data={g.spec} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } scheduleSearch(); }} /></div></div>
                                                {/if}
                                                {#if g.status}
                                                    <div><div class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400">STATUS</div><div class="relative isolate overflow-hidden"><YangView hash={`${g.name}.${g.version}.status`} source={release?.name || 'release'} type={'status'} data={g.status} resourceName={g.name} resourceVersion={g.version} {releaseName} kind={g.kind} clickToSearch={true} on:pathclick={(e) => { const token = e.detail.displayPath || e.detail.path; const toks = query.split(/\s+/).filter(Boolean); if (toks.includes(token)) query = toks.filter(t => t !== token).join(' '); else { toks.push(token); query = toks.join(' '); } scheduleSearch(); }} /></div></div>
                                                {/if}
                                                {#if !g.spec && !g.status}<div class="text-xs text-gray-500 dark:text-gray-400">No matching content</div>{/if}
                                            </div></div></div>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {:else}
                    <div class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-8 text-center sm:rounded-xl sm:py-12 dark:border-gray-700 dark:bg-gray-900/50">
                        <div class="flex flex-col items-center gap-3 sm:gap-4">
                            <div class="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 sm:h-16 sm:w-16 dark:bg-gray-800"><svg class="h-7 w-7 text-gray-400 sm:h-8 sm:w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg></div>
                            <div><h3 class="mb-1 text-base font-medium text-gray-900 sm:mb-2 sm:text-lg dark:text-white">No Results Found</h3><p class="text-xs text-gray-600 sm:text-sm dark:text-gray-300">No CRD spec/status matches the selected release/version (or all versions) and query. Try adjusting your query.</p></div>
                        </div>
                    </div>
                {/if}
                <div class="mx-auto max-w-7xl px-4 py-6"><div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"><PageCredits /></div></div>
            </div>
        </div>
    </div>
</div>

<style>
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
