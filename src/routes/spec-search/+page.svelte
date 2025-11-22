<script lang="ts">
  import yaml from 'js-yaml';
  import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
  import TopHeader from '$lib/components/TopHeader.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Render from '$lib/components/Render.svelte';
  import YangView from '$lib/components/YangView.svelte';
  import { stripResourcePrefixFQDN } from '$lib/components/functions';
  import { expandAll, expandAllScope } from '$lib/store';
  import releasesYaml from '$lib/releases.yaml?raw';
  import type { EdaRelease, ReleasesConfig } from '$lib/structure';

  const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

  let releaseName = '';
  let release: EdaRelease | null = null;
  let versions: string[] = [];
  let version = '';
  let loadingVersions = false;

  let query = '';

      function ensureRenderable(schema: any) {
            if (!schema || typeof schema !== 'object') return schema;
            // If schema already has explicit type or properties/items, return as-is
            if ('type' in schema || 'properties' in schema || 'items' in schema) {
              // Common malformed wrapper: { properties: { spec: { properties: {...} }, ... } }
              // If we detect a top-level properties that contains a `spec` entry that itself
              // looks like a schema, unwrap it so the renderer shows the actual spec fields.
              try {
                if (schema.properties && schema.properties.spec && (schema.properties.spec.properties || schema.properties.spec.items)) {
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
  let results: Array<{ name: string; kind?: string; schema: any; version?: string; type?: 'spec'|'status' }> = [];
  // No filtering via dropdown - always show all results
  $: displayedResults = results;

  // Results view mode: 'tree' shows Render, 'yang' shows dotted path view
  let resultsViewMode: 'tree' | 'yang' = 'tree';

  $: release = releaseName ? releasesConfig.releases.find(r => r.name === releaseName) || null : null;

  async function loadVersions() {
    // Ensure we use the freshly selected release even if the reactive `release` hasn't updated yet
    const rel = release || (releaseName ? releasesConfig.releases.find(r => r.name === releaseName) || null : null);
    if (!rel) { versions = []; version = ''; return; }
    loadingVersions = true;
    try {
      const resp = await fetch(`/${rel.folder}/manifest.json`);
      if (resp.ok) {
        const manifest = await resp.json();
        const versionSet = new Set<string>();
        manifest.forEach((resource: any) => { resource.versions?.forEach((v: any) => { if (v && v.name) versionSet.add(v.name); }); });
        versions = Array.from(versionSet).sort();
      }

      // If manifest fetch failed or produced no versions, fall back to resources.yaml
      if (!versions || versions.length === 0) {
        try {
          const res = await import('$lib/resources.yaml?raw');
          const resources = yaml.load(res.default) as any;
          // resources may be an object with arrays; flatten and collect versions
          const allResources = Object.values(resources).flat();
          const fallbackSet = new Set<string>();
          allResources.forEach((r: any) => { r.versions?.forEach((v: any) => { if (v && v.name) fallbackSet.add(v.name); }); });
          versions = Array.from(fallbackSet).sort();
        } catch (e) {
          // keep versions empty
          versions = [];
        }
      }

      if (!versions.includes(version)) version = '';
    } catch (e) {
      versions = [];
      version = '';
    } finally { loadingVersions = false; }
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

  // Restore description fields from original spec into a pruned/focused schema
  // `isRoot` indicates whether `node` is the top-level spec root; when true we
  // do NOT copy the root `description` (we only want parameter/property descriptions).
  function restoreDescriptions(node: any, original: any, isRoot = false) {
    if (!node || typeof node !== 'object') return node;
    if (!original || typeof original !== 'object') return node;
    try {
      if (!isRoot && 'description' in original && original.description && !('description' in node)) {
        node.description = original.description;
      }
    } catch (e) {
      // ignore
    }
    // Restore properties
    if (node.properties && original.properties) {
      for (const k of Object.keys(node.properties)) {
        try {
          node.properties[k] = restoreDescriptions(node.properties[k], original.properties ? original.properties[k] : undefined, false);
        } catch (e) {
          // ignore per-field
        }
      }
    }
    // Restore items for arrays
    if (node.items && original.items) {
      node.items = restoreDescriptions(node.items, original.items, false);
    }
    return node;
  }

  // Prune schema to include only nodes that match the query (or contain matching descendants)
  // This implementation traverses all common schema branches and returns a schema
  // containing the full ancestor path(s) down to any matching leaf nodes.
  function pruneSchema(node: any, re: RegExp | null, q: string): any | null {
    if (node == null) return null;

    // If primitive-like (no nested schema keys), test stringified value
    if (typeof node !== 'object' || Array.isArray(node) === true && node.length === 0) {
      const s = String(node);
      if (re ? re.test(s) : s.toLowerCase().includes(q.toLowerCase())) return node;
      return null;
    }

    const out: any = {};
    let matched = false;

    // Helper to shallow-copy useful meta (type, format, enum, default, minimum/maximum)
    function copyMeta(src: any, dst: any) {
      // Keep only small, useful metadata to avoid pulling large sibling trees.
      const keys = ['type','format','enum','default','minimum','maximum','pattern','title'];
      for (const k of keys) {
        if (k in src && src[k] !== undefined) dst[k] = src[k];
      }
    }

    // 1) Handle properties
    if (node.properties && typeof node.properties === 'object') {
      const props: any = {};
      for (const [pname, pval] of Object.entries(node.properties)) {
        const pr = pruneSchema(pval as any, re, q);
        if (pr != null) {
          props[pname] = pr;
          matched = true;
        } else {
          // also consider property NAME matching the query
          if (q && String(pname).toLowerCase().includes(q.toLowerCase())) {
            props[pname] = stripDescriptions(pval);
            matched = true;
          }
        }
      }
      if (Object.keys(props).length > 0) {
        out.properties = props;
        if (node.type) out.type = node.type;
      }
    }

    // 2) Handle array items
    if (node.items) {
      const pr = pruneSchema(node.items, re, q);
      if (pr != null) {
        out.items = pr;
        if (node.type) out.type = node.type;
        matched = true;
      }
    }

    // 3) Handle combiners: allOf, anyOf, oneOf
    for (const comb of ['allOf','anyOf','oneOf']) {
      if (Array.isArray(node[comb])) {
        const arr: any[] = [];
        for (const el of node[comb]) {
          const pr = pruneSchema(el, re, q);
          if (pr != null) { arr.push(pr); matched = true; }
        }
        if (arr.length > 0) out[comb] = arr;
      }
    }

    // 4) additionalProperties (object schema)
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      const pr = pruneSchema(node.additionalProperties, re, q);
      if (pr != null) { out.additionalProperties = pr; matched = true; }
    }

    // 5) Inspect non-schema scalar fields (enum values, titles, formats, examples)
    const scalarKeys = ['enum','title','format','pattern','const'];
    for (const k of scalarKeys) {
      if (k in node && node[k] !== undefined) {
        const s = JSON.stringify(node[k]);
        if (re ? re.test(s) : s.toLowerCase().includes(q.toLowerCase())) {
          out[k] = node[k]; matched = true;
        }
      }
    }

    // 6) If nothing matched in children, check the serialized node as a fallback
    if (!matched) {
      try {
        const hay = JSON.stringify(node);
        if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
          // return a stripped minimal node so the caller can decide how to show it
          const minimal = stripDescriptions(node);
          // avoid returning huge objects wholesale
          if (minimal && minimal.properties && Object.keys(minimal.properties).length > 30) return null;
          return minimal;
        }
      } catch (e) {
        // ignore
      }
      return null;
    }

    // Copy some metadata to out to preserve shape
    copyMeta(node, out);

    return out;
  }

  function escapeHtml(s: string) {
    const entityMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s ?? '').replace(/[&<>"']/g, (c) => entityMap[c] ?? c);
  }
  function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
        parts.push(`<mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(start, end))}</mark>`);
        lastIndex = end;
        if (re.lastIndex === match.index) re.lastIndex++; // guard
      }
      parts.push(escapeHtml(hay.substring(lastIndex)));
      return parts.join('');
    } catch (e) {
      // fallback substring
      const idx = hay.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return escapeHtml(hay);
      return `${escapeHtml(hay.substring(0, idx))}<mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(idx, idx+query.length))}</mark>${escapeHtml(hay.substring(idx+query.length))}`;
    }
  }

  async function performSearch() {
    results = [];
    if (!release || !query) return;
    loading = true;
    try {
      const resp = await fetch(`/${release.folder}/manifest.json`);
      if (!resp.ok) return;
      const manifest = await resp.json();
      const q = String(query ?? '').trim();
      let re: RegExp | null = null;
      try { re = new RegExp(q, 'i'); } catch (e) { re = null; }

      const promises = manifest.flatMap(async (res: any) => {
        if (!res || !res.name) return [];
        // Skip CRDs that are states
        if (String(res.name).toLowerCase().includes('states')) return [];
        // select candidate versions according to flag
          const candidateVersions = version ? [version] : (res.versions ? res.versions.map((v:any) => v.name) : []);
        const matches: Array<any> = [];
        for (const ver of candidateVersions) {
          try {
            const path = `/${release.folder}/${res.name}/${ver}.yaml`;
            const r = await fetch(path);
            if (!r.ok) continue;
            const txt = await r.text();
            const parsed = yaml.load(txt) as any;
            const spec = parsed?.schema?.openAPIV3Schema?.properties?.spec;
            const status = parsed?.schema?.openAPIV3Schema?.properties?.status;

            // search spec
            if (spec) {
              const stripped = stripDescriptions(spec);
              const pruned = pruneSchema(stripped, re, q);
              if (pruned) {
                let readySchema = pruned;
                try {
                  if ((!pruned.properties || Object.keys(pruned.properties).length === 0) && Array.isArray(pruned.required) && stripped && stripped.properties) {
                    const focusedProps: any = {};
                    for (const rk of pruned.required) {
                      if (rk in stripped.properties) focusedProps[rk] = stripped.properties[rk];
                    }
                    if (Object.keys(focusedProps).length > 0) {
                      readySchema = { type: 'object', properties: focusedProps, required: pruned.required };
                    }
                  }
                } catch (e) { readySchema = pruned; }
                try { readySchema = restoreDescriptions(readySchema, spec, true); } catch (e) { /* ignore */ }
                const ready = ensureRenderable(readySchema);
                matches.push({ name: res.name, kind: res.kind, schema: ready, version: ver, type: 'spec' });
                // continue to next version; we still check status though for same version
              } else {
                try {
                  const hay = JSON.stringify(stripped);
                  if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
                    let readySchema = spec;
                    try { readySchema = restoreDescriptions(readySchema, spec, true); } catch (e) { /* ignore */ }
                    const ready = ensureRenderable(readySchema);
                    matches.push({ name: res.name, kind: res.kind, schema: ready, version: ver, type: 'spec' });
                  }
                } catch (e) { /* ignore */ }
              }
            }

            // search status
            if (status) {
              const strippedStatus = stripDescriptions(status);
              const prunedStatus = pruneSchema(strippedStatus, re, q);
              if (prunedStatus) {
                let readyStatus = prunedStatus;
                try { readyStatus = restoreDescriptions(readyStatus, status, true); } catch (e) { /* ignore */ }
                const ensured = ensureRenderable(readyStatus);
                matches.push({ name: res.name, kind: res.kind, schema: ensured, version: ver, type: 'status' });
              } else {
                try {
                  const hay = JSON.stringify(strippedStatus);
                  if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
                    let readyStatus = status;
                    try { readyStatus = restoreDescriptions(readyStatus, status, true); } catch (e) { /* ignore */ }
                    const ensured = ensureRenderable(readyStatus);
                    matches.push({ name: res.name, kind: res.kind, schema: ensured, version: ver, type: 'status' });
                  }
                } catch (e) { /* ignore */ }
              }
            }
          } catch (e) {
            // ignore and continue to next version
          }
        }
        return matches;
      });
      const settled = await Promise.all(promises);
      results = settled.flat().filter(Boolean) as any;
    } finally { loading = false; }
  }
</script>

<svelte:head>
  <title>EDA Resource Browser | Search CRD Specs</title>
</svelte:head>

<AnimatedBackground />

<TopHeader title="Search CRD Specs & Status" />

<div class="relative flex flex-col lg:min-h-screen overflow-y-auto lg:overflow-hidden pt-16 md:pt-20">
    <div class="flex flex-1 flex-col lg:flex-row relative z-10">
      <div class="flex-1 overflow-auto pb-16">
        <div class="max-w-7xl mx-auto px-4 py-8">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <!-- Header moved to TopHeader component (fixed top) -->
          </div>

          <div class="space-y-6 sm:space-y-8">
            <div>
              <div id="spec-search-description" class="mb-3 text-base text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/10 border border-gray-200 dark:border-gray-800 rounded-lg p-3">Select a release and version (leave the version blank to search all versions), then search inside CRD spec and status schemas. Descriptions are ignored to focus matches on parameters and values.</div>
              <label for="spec-release" class="block text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2 sm:mb-3">Release & Version</label>
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 items-start">
                <div class="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div class="relative">
                  <select id="spec-release" aria-describedby="spec-search-description"
                    bind:value={releaseName}
                    on:change={loadVersions}
                    class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
                    style="z-index:1000;"
                  >
                    <option value="">Select release...</option>
                    {#each releasesConfig.releases as r}
                      <option value={r.name}>{r.label}</option>
                    {/each}
                  </select>
                  </div>
                  <div class="relative">
                  <select id="spec-version" aria-describedby="spec-search-description" bind:value={version} class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm" style="z-index:1000;" disabled={!release || versions.length === 0 || loadingVersions}>
                    <option value="">{loadingVersions ? 'Loading versions...' : 'All versions'}</option>
                    {#each versions as v}
                      <option value={v}>{v}</option>
                    {/each}
                  </select>
                </div>
                <!-- By default we search all versions if none selected -->
                
              </div>

              <div class="relative pt-4">
                <!-- divider moved below search row -->
              </div>
            </div>
          </div>
      <!-- Independent Search Bar (clean, pro) like Bulk Diff (separate from result table) -->
          <div class="mb-4">
            <div class="flex items-center gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"/></svg>
            </div>
            <input id="spec-query" bind:value={query} on:input={() => { /* no-op */ }} on:keydown={(e) => e.key === 'Enter' && performSearch()} placeholder="Search specs & status (regex)" class="w-full rounded-lg border border-gray-300 dark:border-gray-600 pl-9 pr-10 py-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" />
            {#if query}
              <button aria-label="Clear search" on:click={() => { query = ''; results = []; }} class="absolute right-3 top-1/2 -translate-y-1/2 p-1 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-200">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            {/if}
          </div>
          <div class="flex items-center gap-3">
            <button on:click={performSearch} class="px-4 py-2 rounded bg-purple-600 text-white" disabled={!release || !query || loading}>
              {#if loading}
                <span>Searching...</span>
              {:else}
                Search
              {/if}
            </button>
            <!-- Filter dropdown removed; all results are shown -->
            <button on:click={() => { expandAll.update(v => { const nv = !v; expandAllScope.set('global'); return nv }); }} class="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium">
              {#if $expandAll}Collapse All{:else}Expand All{/if}
            </button>
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400">{displayedResults.length} matches</div>
          <div class="ml-3 flex items-center gap-2">
            <span class="text-xs text-gray-900 dark:text-gray-200 mr-2">View:</span>
            <button
              on:click={() => resultsViewMode = 'tree'}
              class="px-2 py-1 rounded-md text-xs font-semibold {resultsViewMode === 'tree' ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}"
            >Tree</button>
            <button
              on:click={() => resultsViewMode = 'yang'}
              class="px-2 py-1 rounded-md text-xs font-semibold {resultsViewMode === 'yang' ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}"
            >YANG</button>
          </div>
        </div>
      </div>

      <!-- Divider / progress bar under search row -->
      <div class="relative pt-4 border-t border-gray-200">
        {#if loading}
          <div class="absolute left-0 right-0 -top-1 h-1 pointer-events-none">
            <div class="w-full bg-gray-200 dark:bg-gray-700 h-1">
              <div class="bg-purple-600 h-1 rounded-full" style="width: 100%"></div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Results -->
      {#if displayedResults.length > 0}
        <!-- Mobile stacked cards -->
        <div class="space-y-3 sm:hidden">
          {#each displayedResults as r}
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 mr-2">
                    <div class="text-sm font-semibold text-gray-900 dark:text-white break-words">{r.kind}</div>
                                    <div class="text-xs text-gray-600 dark:text-gray-300">{stripResourcePrefixFQDN(String(r.name))}</div>
                </div>
                <div class="flex items-center gap-2">
                  {#if r.version}
                    <div class="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200">{r.version}</div>
                  {/if}
                </div>
                
              </div>
              <div class="mt-3">
                <div class="text-xs text-gray-900 dark:text-gray-200 whitespace-normal break-words">
                  {#if resultsViewMode === 'tree'}
                    <Render hash={`${r.name}.${r.version}`} source={release?.name || 'release'} type={r.type || 'spec'} data={r.schema} />
                  {:else}
                    <YangView hash={`${r.name}.${r.version}`} source={release?.name || 'release'} type={r.type || 'spec'} data={r.schema} resourceName={r.name} resourceVersion={r.version} releaseName={releaseName} />
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>

        <!-- Desktop table -->
        <div class="hidden sm:block overflow-x-auto rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <table class="table-auto w-full text-xs sm:text-sm">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Resource</th>
                <th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Version</th>
                <th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Match</th>
                <!-- Actions column removed to avoid duplicate 'Open' behavior; use '#' anchor inside Tree/YANG items instead -->
              </tr>
            </thead>
            <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {#each displayedResults as r}
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td class="px-3 sm:px-6 py-3 sm:py-4 font-medium text-gray-900 dark:text-white break-words whitespace-pre-wrap max-w-[40%]"><div class="font-semibold">{r.kind}</div><div class="text-xs text-gray-500 dark:text-gray-300">{stripResourcePrefixFQDN(String(r.name))}</div></td>
                  <td class="px-3 sm:px-6 py-3 sm:py-4 text-gray-600 dark:text-gray-300 break-words whitespace-pre-wrap max-w-[12%]">{r.version}</td>
                  <td class="px-3 sm:px-6 py-3 sm:py-4 text-gray-900 dark:text-gray-200 break-words whitespace-normal max-w-[40%]"><div class="pro-spec-preview max-h-[40rem] overflow-auto">
                    {#if resultsViewMode === 'tree'}
                      <Render hash={`${r.name}.${r.version}`} source={release?.name || 'release'} type={r.type || 'spec'} data={r.schema} />
                    {:else}
                      <YangView hash={`${r.name}.${r.version}`} source={release?.name || 'release'} type={r.type || 'spec'} data={r.schema} resourceName={r.name} resourceVersion={r.version} releaseName={releaseName} />
                    {/if}
                  </div></td>
                
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="text-center py-8 sm:py-12 bg-gray-50 dark:bg-gray-900/50 rounded-lg sm:rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700">
          <div class="flex flex-col items-center gap-3 sm:gap-4">
            <div class="w-14 h-14 sm:w-16 sm:h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <svg class="w-7 h-7 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </div>
                  </div>
                </div>
                <!-- By default we search all versions if none selected -->
              <p class="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">No CRD spec/status matches the selected release/version (or all versions) and query. Try adjusting your query.</p>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
  </div>
  <Footer />
</div>
