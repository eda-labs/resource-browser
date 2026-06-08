<script lang="ts">
    import { loadStaticYaml } from '$lib/yaml/safeYaml';
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    // AnimatedBackground is dynamically imported/rendered by the layout; avoid importing here to keep it lazy
    import AppHeader from '$lib/components/AppHeader.svelte';
    import PageCredits from '$lib/components/PageCredits.svelte';
    import ResourceModal from '$lib/components/ResourceModal.svelte';
    import { stripResourcePrefixFQDN } from '$lib/components/functions';
    import type { CrdResource } from '$lib/structure';
    import {
        extractPaths,
        markMatchingNodes,
        type PathInfo
    } from '$lib/spec-search/schemaUtils';
    import { fetchManifest } from '$lib/manifest';
    import { searchManifest, type SearchMatch } from '$lib/spec-search/searchEngine';
    // expandAll controls removed from this auto-search page (no UI button)
    import releasesYaml from '$lib/releases.yaml?raw';
    import type { EdaRelease, ReleasesConfig } from '$lib/structure';

    const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

    let releaseName = '';
    let release: EdaRelease | null = null;
    let versions: string[] = [];
    let version = '';
    let loadingVersions = false;

    let query = '';
    let searchInDescription = false;
    let modalOpen = false;
    let modalResource: CrdResource | null = null;
    let modalInitialVersion: string | null = null;
    let modalHighlightPaths: string[] = [];
    let modalDisplaySpec: unknown = null;
    let modalDisplayStatus: unknown = null;

    // Client-only init: URL params, version list, and initial search run in onMount (see homepage pattern).
    let clientReady = false;

    function updateURL() {
        if (!browser) return;

        const params = new URLSearchParams();
        if (releaseName) params.set('release', releaseName);
        if (version) params.set('version', version);
        if (query && query.trim()) params.set('q', query);

        const targetUrl = `/spec-search${params.toString() ? `?${params.toString()}` : ''}`;
        const currentUrl = `${$page.url.pathname}${$page.url.search}`;
        if (targetUrl === currentUrl) return;

        goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
    }

    const SEARCH_DEBOUNCE_MS = 250;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let searchGeneration = 0;

    let searching = false;
    let results: SearchMatch[] = [];
    const MAX_RESULTS = 100;

    type GroupedResult = {
        name: string;
        kind?: string;
        version?: string;
        spec?: unknown;
        status?: unknown;
        specPaths: PathInfo[];
        statusPaths: PathInfo[];
        fullSpec?: unknown;
        fullStatus?: unknown;
    };

    let groupedResults: GroupedResult[] = [];

    function groupSearchResults(matches: SearchMatch[]): GroupedResult[] {
        const map = new Map<string, GroupedResult>();
        for (const r of matches) {
            const key = `${r.name}::${r.version || ''}`;
            if (!map.has(key)) {
                map.set(key, {
                    name: r.name,
                    kind: r.kind,
                    version: r.version,
                    specPaths: [],
                    statusPaths: [],
                    fullSpec: r.fullSpec,
                    fullStatus: r.fullStatus
                });
            }
            const entry = map.get(key)!;
            if (r.type === 'spec') {
                entry.spec = entry.spec || r.schema;
                entry.fullSpec = entry.fullSpec || r.fullSpec;
                if (entry.specPaths.length === 0) {
                    entry.specPaths = extractPaths(r.schema, 'spec');
                }
            }
            if (r.type === 'status') {
                entry.status = entry.status || r.schema;
                entry.fullStatus = entry.fullStatus || r.fullStatus;
                if (entry.statusPaths.length === 0) {
                    entry.statusPaths = extractPaths(r.schema, 'status');
                }
            }
        }
        return Array.from(map.values()).slice(0, MAX_RESULTS);
    }

    const yamlCache: Map<string, string> = new Map();
    const parsedCache: Map<string, { spec?: unknown; status?: unknown }> = new Map();

    // Prefetch manifest for the currently-selected release to reduce first-search latency
    $: if (browser && clientReady && release?.folder) {
        void fetchManifest(release.folder);
    }

    $: release = releaseName
        ? releasesConfig.releases.find((r) => r.name === releaseName) || null
        : null;

    function openResourceModal(g: GroupedResult) {
        const matchedPaths = new Set<string>();
        for (const p of g.specPaths) matchedPaths.add(p.path);
        for (const p of g.statusPaths) matchedPaths.add(p.path);
        modalHighlightPaths = [...matchedPaths];
        modalDisplaySpec = g.fullSpec
            ? markMatchingNodes(g.fullSpec, matchedPaths, 'spec')
            : null;
        modalDisplayStatus = g.fullStatus
            ? markMatchingNodes(g.fullStatus, matchedPaths, 'status')
            : null;
        modalInitialVersion = g.version || null;
        modalResource = {
            name: g.name,
            kind: g.kind || g.name.split('.')[0],
            group: g.name.split('.').slice(1).join('.'),
            versions: g.version
                ? [{ name: g.version, deprecated: false, appVersion: '' }]
                : []
        };
        modalOpen = true;
    }

    function closeResourceModal() {
        modalOpen = false;
        modalResource = null;
        modalInitialVersion = null;
        modalHighlightPaths = [];
        modalDisplaySpec = null;
        modalDisplayStatus = null;
    }

    async function loadVersions() {
        if (!browser) return;

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
            const manifest = await fetchManifest(rel.folder);
            if (manifest) {
                const versionSet = new Set<string>();
                manifest.forEach((resource) => {
                    resource.versions?.forEach((v) => {
                        if (v?.name) versionSet.add(v.name);
                    });
                });
                versions = Array.from(versionSet).sort();
            }
            if (!versions || versions.length === 0) {
                try {
                    const res = await import('$lib/resources.yaml?raw');
                    const resources = loadStaticYaml(res.default) as any;
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

    async function performSearch() {
        if (!browser || !release || !query.trim()) return;

        const generation = ++searchGeneration;
        searching = true;

        try {
            const manifest = await fetchManifest(release.folder);
            if (!manifest || generation !== searchGeneration) return;

            const matches = await searchManifest({
                releaseFolder: release.folder,
                manifest,
                query: query.trim(),
                version,
                searchInDescription,
                maxResults: MAX_RESULTS,
                yamlCache,
                parsedCache,
                isCancelled: () => generation !== searchGeneration,
                onProgress: (progress) => {
                    if (generation !== searchGeneration) return;
                    results = progress.matches;
                    if (progress.done) {
                        groupedResults = groupSearchResults(progress.matches);
                    }
                }
            });

            if (generation !== searchGeneration) return;
            results = matches;
            groupedResults = groupSearchResults(matches);
        } finally {
            if (generation === searchGeneration) {
                searching = false;
            }
        }
    }

    function scheduleSearch(immediate = false) {
        if (!browser || !clientReady) return;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        if (!release || !releaseName) {
            searchGeneration++;
            results = [];
            groupedResults = [];
            searching = false;
            return;
        }

        if (!query || query.trim().length === 0) {
            searchGeneration++;
            results = [];
            groupedResults = [];
            searching = false;
            updateURL();
            return;
        }

        searching = true;

        const run = () => {
            debounceTimer = null;
            void performSearch();
            updateURL();
        };

        if (immediate) {
            run();
        } else {
            debounceTimer = setTimeout(run, SEARCH_DEBOUNCE_MS);
        }
    }

    let previousQuery = '';
    $: if (browser && clientReady && query !== previousQuery) {
        previousQuery = query;
        scheduleSearch();
    }

    let previousSearchInDescription = false;
    $: if (
        browser &&
        clientReady &&
        searchInDescription !== previousSearchInDescription &&
        query.trim()
    ) {
        previousSearchInDescription = searchInDescription;
        scheduleSearch(true);
    }

    function handleYangPathClick(e: CustomEvent<{ displayPath?: string; path?: string }>) {
        try {
            const token = (e?.detail?.displayPath || e?.detail?.path) as string;
            if (!token) return;
            const toks = query.split(/\s+/).filter(Boolean);
            if (toks.includes(token)) query = toks.filter((t: string) => t !== token).join(' ');
            else {
                toks.push(token);
                query = toks.join(' ');
            }
            scheduleSearch(true);
        } catch {
            /* ignore */
        }
    }

    onMount(async () => {
        const urlRelease = $page.url.searchParams.get('release');
        const urlVersion = $page.url.searchParams.get('version');
        const urlQuery = $page.url.searchParams.get('q');

        if (urlRelease) {
            releaseName = urlRelease;
        } else {
            const defaultRelease =
                releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
            if (defaultRelease) {
                releaseName = defaultRelease.name;
            }
        }
        if (urlVersion) {
            version = urlVersion;
        }
        if (urlQuery) {
            query = urlQuery;
            previousQuery = urlQuery;
        }
        previousSearchInDescription = searchInDescription;

        await loadVersions();

        if (urlQuery?.trim()) {
            await performSearch();
        }

        clientReady = true;

        document.addEventListener('yang:pathclick', handleYangPathClick as EventListener);
    });

    onDestroy(() => {
        if (browser) {
            document.removeEventListener('yang:pathclick', handleYangPathClick as EventListener);
        }
    });
</script>

<svelte:head>
    <title>EDA Resource Browser | Spec Search</title>
    <meta
        name="description"
        content="Search CRD schema property paths across Nokia EDA releases — find spec and status fields by name or description."
    />
</svelte:head>

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
    <AppHeader fixed={false} />

    <div class="spec-search-main">
        <section class="spec-search-hero" aria-labelledby="spec-search-heading">
            <p class="homepage-hero-kicker">Schema discovery</p>
            <h1 id="spec-search-heading" class="homepage-title text-slate-900 dark:text-slate-100">
                Search CRD property paths
            </h1>
            <p class="homepage-subtitle text-slate-600 dark:text-slate-400">
                Find spec and status fields across resources — filter by release, version, and optional
                description text.
            </p>
        </section>

        <div class="spec-search-filters" role="search" aria-label="Spec search filters">
            <select
                id="spec-release"
                bind:value={releaseName}
                on:change={async () => {
                    await loadVersions();
                    if (query.trim()) scheduleSearch(true);
                }}
                class="spec-search-select min-w-[10rem] flex-1 sm:flex-none"
            >
                <option value="">Select release…</option>
                {#each releasesConfig.releases as r}
                    <option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
                {/each}
            </select>

            <select
                id="spec-version"
                bind:value={version}
                on:change={() => {
                    updateURL();
                    if (query && query.trim()) {
                        scheduleSearch(true);
                    }
                }}
                class="spec-search-select min-w-[8rem] flex-1 sm:flex-none"
                disabled={!release || versions.length === 0 || loadingVersions}
            >
                <option value="">{loadingVersions ? 'Loading…' : 'All versions'}</option>
                {#each versions as v}
                    <option value={v}>{v}</option>
                {/each}
            </select>

            <label
                class="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800/80"
            >
                <input
                    type="checkbox"
                    bind:checked={searchInDescription}
                    class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700"
                />
                <span class="text-slate-700 dark:text-slate-300">Include descriptions</span>
            </label>

            {#if loadingVersions}
                <div class="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                    </svg>
                    Loading versions…
                </div>
            {:else if groupedResults.length > 0}
                <div class="ml-auto flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {#if searching}
                        <svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Updating…</span>
                    {/if}
                    {groupedResults.length} resource{groupedResults.length !== 1 ? 's' : ''}
                    {#if results.length > MAX_RESULTS}
                        <span class="text-amber-600 dark:text-amber-400">
                            (first {MAX_RESULTS})
                        </span>
                    {/if}
                </div>
            {/if}
        </div>

        <div class="homepage-search-zone">
            <label for="spec-query" class="sr-only">Search property paths</label>
            <div class="relative">
                <div
                    class="homepage-search-input border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                >
                    <svg
                        class="homepage-search-icon text-slate-400 dark:text-slate-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <input
                        id="spec-query"
                        bind:value={query}
                        on:keydown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                scheduleSearch(true);
                            }
                        }}
                        placeholder={release
                            ? 'Search paths (e.g. vlan, macLimit, adminState)…'
                            : 'Select a release to start searching…'}
                        class="homepage-search-field text-slate-900 placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                        disabled={!release}
                        autocomplete="off"
                        aria-busy={searching}
                    />
                    {#if searching}
                        <svg
                            class="h-4 w-4 shrink-0 animate-spin text-slate-400 dark:text-slate-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            aria-label="Searching"
                        >
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path
                                class="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                        </svg>
                    {/if}
                    {#if query}
                        <button
                            type="button"
                            aria-label="Clear search"
                            on:click|preventDefault|stopPropagation={() => {
                                query = '';
                                previousQuery = '';
                                searchGeneration++;
                                results = [];
                                groupedResults = [];
                                searching = false;
                                updateURL();
                            }}
                            class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                        >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    {/if}
                </div>
            </div>
        </div>

        <div class="spec-search-results-panel" class:opacity-70={searching && groupedResults.length > 0} class:transition-opacity={searching}>
            {#if loadingVersions}
                    <!-- Loading Skeleton -->
                    <div class="space-y-4 p-4">
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
                {:else if groupedResults.length > 0}
                    <!-- Mobile Cards -->
                    <div class="space-y-2 sm:hidden">
                        {#each groupedResults as g}
                            <button
                                on:click={(e) => {
                                    e.preventDefault();
                                    openResourceModal(g);
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
                                            <div>
                                                <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                                                    Spec
                                                </span>
                                                <div class="mt-1 flex flex-wrap gap-1">
                                                    {#each g.specPaths as pathInfo}
                                                        <span class="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                            {pathInfo.path}
                                                        </span>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                        {#if g.status}
                                            <div>
                                                <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                                    Status
                                                </span>
                                                <div class="mt-1 flex flex-wrap gap-1">
                                                    {#each g.statusPaths as pathInfo}
                                                        <span class="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                            {pathInfo.path}
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
                                            openResourceModal(g);
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
                                                {#if g.spec && g.specPaths.length > 0}
                                                    <div class="rounded border border-cyan-200 bg-cyan-50/30 p-1.5 dark:border-cyan-800 dark:bg-cyan-900/20">
                                                        <div class="mb-1 text-xs font-semibold text-cyan-700 dark:text-cyan-400">Spec</div>
                                                        <div class="space-y-0.5">
                                                            {#each g.specPaths as pathInfo}
                                                                <div class="group relative flex items-center gap-1.5 flex-wrap">
                                                                    <span class="text-xs font-mono text-amber-700 dark:text-amber-300">{pathInfo.path}</span>
                                                                    {#if pathInfo.type}
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
                                                {#if g.status && g.statusPaths.length > 0}
                                                    <div class="rounded border border-green-200 bg-green-50/30 p-1.5 dark:border-green-800 dark:bg-green-900/20">
                                                        <div class="mb-1 text-xs font-semibold text-green-700 dark:text-green-400">Status</div>
                                                        <div class="space-y-0.5">
                                                            {#each g.statusPaths as pathInfo}
                                                                <div class="group relative flex items-center gap-1.5 flex-wrap">
                                                                    <span class="text-xs font-mono text-amber-700 dark:text-amber-300">{pathInfo.path}</span>
                                                                    {#if pathInfo.type}
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
                    <div class="spec-search-empty">
                        <div class="spec-search-empty-icon">
                            <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                                />
                            </svg>
                        </div>
                        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                            {#if loadingVersions}
                                Loading release data…
                            {:else if searching && query.trim()}
                                Searching…
                            {:else if !release || !releaseName}
                                Select a release
                            {:else if !query}
                                Start typing to search
                            {:else}
                                No matching paths
                            {/if}
                        </h3>
                        <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                            {#if loadingVersions}
                                Fetching version list for the selected release.
                            {:else if searching && query.trim()}
                                Scanning schema paths across {release?.label ?? 'the selected release'}…
                            {:else if !release || !releaseName}
                                Choose an EDA release above to search spec and status schema paths.
                            {:else if !query}
                                Enter property names like <span class="font-mono">vlan</span> or
                                <span class="font-mono">adminState</span> — results update as you type.
                            {:else}
                                No matches for “{query}”. Try shorter terms or enable description search.
                            {/if}
                        </p>
                        {#if query && !searching}
                            <button
                                type="button"
                                on:click={() => {
                                    query = '';
                                    previousQuery = '';
                                    searchGeneration++;
                                    results = [];
                                    groupedResults = [];
                                    updateURL();
                                }}
                                class="homepage-browse-cta mt-4"
                            >
                                Clear search
                            </button>
                        {/if}
                    </div>
                {/if}
        </div>

        <div class="mt-6">
            <PageCredits />
        </div>
    </div>
</div>

{#if release}
    <ResourceModal
        open={modalOpen}
        resourceDef={modalResource}
        selectedRelease={release}
        allReleases={releasesConfig.releases}
        initialVersion={modalInitialVersion}
        highlightPaths={modalHighlightPaths}
        displaySpec={modalDisplaySpec}
        displayStatus={modalDisplayStatus}
        onClose={closeResourceModal}
    />
{/if}
