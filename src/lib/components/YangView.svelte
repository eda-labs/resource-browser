<script lang="ts">
  import { copy } from 'svelte-copy';
  import Render from './Render.svelte';
  import { stripResourcePrefixFQDN } from './functions';
  import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
  import yaml from 'js-yaml';
  import releasesYaml from '$lib/releases.yaml?raw';
  import type { ReleasesConfig } from '$lib/structure';
  import { onDestroy } from 'svelte';
  import { getScope } from './functions';
  // (ulExpanded imported above)
  import type { Schema } from '$lib/structure';

  // Action to move an element to document.body (portal) so modals avoid parent stacking contexts
  function portal(node: HTMLElement) {
    if (typeof document === 'undefined') return { destroy() {} };
    const target = document.body;
    target.appendChild(node);
    return {
      destroy() {
        try { if (node.parentNode) node.parentNode.removeChild(node); } catch (e) { /* ignore */ }
      }
    };
  }

  export let hash: string = '';
  export let source: string = '';
  export let type: string = '';
  export let data: Schema;
  export let resourceName: string = '';
  export let resourceVersion: string | null = null;
  export let releaseName: string | null = null;

  // Defensive: if parent provided text/primitive content as the `data` prop (or via
  // unexpected slot mapping), ensure we ignore it so the model/schema isn't
  // overridden by stray text. This must run before any consumers (like
  // collectPaths) access `data`.
  if (data !== null && (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean')) {
    // Clear invalid primitive value; prefer undefined so other checks treat it as missing
    data = undefined as unknown as Schema;
    // eslint-disable-next-line no-console
    console.warn('YangView: ignored primitive `data` passed from parent');
  }

  function joinPath(prefix: string, piece: string) {
    if (!prefix) return piece;
    return `${prefix}.${piece}`;
  }

  type YangPath = {
    path: string;
    displayPath: string;
    t?: string;
    required?: boolean;
  };

  function isPrimitiveType(t: any) {
    if (!t) return false;
    return ['string', 'integer', 'number', 'boolean', 'null'].includes(t);
  }

  function isLeafNode(n: any): boolean {
    if (!n) return true;
    const s = getScope(n);
    // If it has properties, it's not leaf
    if (s && 'properties' in s && s.properties && Object.keys(s.properties).length > 0) return false;
    // If it's an array and items is an object with properties, it's not a leaf
    if (s && 'items' in s) {
      const items = (s as any).items;
      const itemsScope = getScope(items);
      if (itemsScope && 'properties' in itemsScope && itemsScope.properties && Object.keys(itemsScope.properties).length > 0) return false;
      // if items is not primitive -> not leaf
      if (!isPrimitiveType(itemsScope?.type)) return false;
    }
    // If the node type is object but without properties, not primitive (treat as non-leaf)
    if (s && s.type === 'object' && (!s.properties || Object.keys(s.properties).length === 0)) {
      // This often is container object with no properties, so treat as leaf? We'll consider as leaf as it has no child properties
      return true;
    }
    // If it's primitive or an array of primitives, it's a leaf
    if (s && isPrimitiveType(s.type)) return true;
    return true; // default to true if none of the checks say otherwise
  }

  function collectPaths(node: any, prefix = ''): YangPath[] {
    if (!node) return [];
    const scope = getScope(node);
    const out: YangPath[] = [];

    // If node directly has properties, iterate
    if ('properties' in scope && typeof scope.properties === 'object') {
      const reqList: string[] = ('required' in scope && Array.isArray((scope as any).required)) ? (scope as any).required : [];
      for (const [k, v] of Object.entries(scope.properties)) {
        const newPrefix = joinPath(prefix, k);
        const thisScope = getScope(v as any);

        // If this is a leaf node, include it
        if (isLeafNode(v)) {
            const p: YangPath = {
            path: `${type}.${newPrefix}`,
            displayPath: `${type}.${newPrefix}`,
            t: (thisScope && thisScope.type) || (v && (v as any).type) || undefined,
            required: reqList.includes(k)
          };
          out.push(p);
        }

        // Recurse into child properties (if properties present) to find deeper leaf nodes
        if ('properties' in thisScope) {
          out.push(...collectPaths(v, newPrefix));
        }

        // Handle arrays
        if ('items' in thisScope) {
          const arrPrefix = `${newPrefix}[]`;
          const itemsScope = getScope(thisScope.items as Schema);
          // If items are primitive, it's a leaf
          if (isPrimitiveType(itemsScope?.type)) {
            const arrPath: YangPath = {
              path: `${type}.${arrPrefix}`,
              displayPath: `${type}.${arrPrefix}`,
              t: 'array'
            };
            out.push(arrPath);
          } else {
            // If items have properties, descend
            if ('properties' in itemsScope) {
              out.push(...collectPaths(thisScope.items, arrPrefix));
            }
          }
        }
      }
    }
    return out;
  }

  const paths = data && typeof data === 'object' ? collectPaths(data, '') : [];

  

  const typeColors = {
    'string': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    'integer': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    'number': 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
    'boolean': 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
    'object': 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
    'array': 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800'
  };

  let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
  let copiedPath: string | null = null;
  $: { void hash; void source; }
  // (no per-field expanded values required for YANG view summary)

  // Modal state for displaying full resource tree for a selected path
  let showResourceModal: boolean = false;
  let modalSpec: Schema | null = null;
  let modalStatus: Schema | null = null;
  let modalError: string | null = null;
  // the hash to expand/focus inside the modal, e.g. 'spec.attachments.interface'
  let modalHash: string = '';
  let isLoadingModal: boolean = false;
  let prevExpandAll: boolean | null = null;
  let prevExpandAllScope: string | null = null;
  let modalTitleId: string | null = null;
  let prevDocumentTitle: string | null = null;

  async function openResource(path: string) {
    // Instead of opening a new tab, show the compact resource modal and focus the path.
    modalSpec = null; modalStatus = null; modalError = null; modalHash = path;
    isLoadingModal = true;
    // Save previous expand state and enforce collapse except for selected path
    prevExpandAll = null; prevExpandAllScope = null;
    try {
      prevExpandAll = $expandAll;
      prevExpandAllScope = $expandAllScope;
    } catch (e) {
      // ignore (SSR contexts may not have store value)
    }
    expandAll.set(false);
    expandAllScope.set('local');
    // Create a unique title id for the modal so we can attach aria-labelledby and
    // include the resource name in the title for accessibility and clarity.
    modalTitleId = `yangview-dialog-title-${stripResourcePrefixFQDN(resourceName || 'resource')}-${Math.random().toString(36).slice(2,8)}`;
    // Update the document title while the modal is open to reflect the resource
    if (typeof window !== 'undefined') {
      try {
        prevDocumentTitle = document.title;
        document.title = `${stripResourcePrefixFQDN(resourceName || '')}${resourceVersion ? ' ' + resourceVersion : ''}${releaseName ? ' · ' + releaseName : ''} | EDA Resource Browser`;
        // Prevent background scrolling to avoid visual overlap
        try { document.body.style.overflow = 'hidden'; } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    }
    showResourceModal = true;
    expandAll.set(false);
    // compute ulExpanded from path (expand only ancestors)
    const parts = path.split('.');
    const ancestors: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      ancestors.push(parts.slice(0, i).join('.'));
    }
    ulExpanded.set(ancestors);

    // fetch the resource YAML for the given release/resource/version
    try {
      // Resolve the release folder from releaseName (if provided)
      let releaseFolder = '';
      try {
        const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
        if (releaseName && releaseName !== 'release') {
          const found = releasesConfig.releases.find((r) => r.name === releaseName);
          if (found) releaseFolder = found.folder;
        }
        if (!releaseFolder && (releasesConfig && releasesConfig.releases && releasesConfig.releases.length > 0)) {
          // fallback to default release folder
          const defaultRel = releasesConfig.releases.find(r => r.default) || releasesConfig.releases[0];
          releaseFolder = defaultRel.folder;
        }
      } catch (e) {
        // ignore and fallback to raw release name
      }
      let folder = releaseName || '';
      let url = '';
      if (releaseFolder) {
        folder = releaseFolder;
      }
      if (resourceVersion) {
        url = `/${folder}/${resourceName}/${resourceVersion}.yaml`;
      } else {
        url = `/${folder}/${resourceName}.yaml`;
      }
      let resp = await fetch(url);
      if (!resp.ok) {
        // fallback to `/resources` static path
        if (resourceVersion) {
          resp = await fetch(`/resources/${resourceName}/${resourceVersion}.yaml`);
        } else {
          resp = await fetch(`/resources/${resourceName}.yaml`);
        }
      }
      // If we still don't have resource YAML, try to locate it in other releases
      if (!resp.ok) {
        try {
          const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
          for (const r of releasesConfig.releases) {
            try {
              const pathCandidate = resourceVersion ? `/${r.folder}/${resourceName}/${resourceVersion}.yaml` : `/${r.folder}/${resourceName}.yaml`;
              const check = await fetch(pathCandidate);
              if (check.ok) { resp = check; break; }
            } catch (inner) {
              // ignore per-release errors
            }
          }
        } catch (e) {
          // ignore
        }
      }
      if (!resp.ok) {
        modalError = `Failed to load resource ${resourceName} ${resourceVersion || ''}`;
        return;
      }
      const txt = await resp.text();
      const parsed = yaml.load(txt) as any;
      modalSpec = parsed?.schema?.openAPIV3Schema?.properties?.spec || null;
      modalStatus = parsed?.schema?.openAPIV3Schema?.properties?.status || null;
      // Fallback to the current data if parsed YAML doesn't include full spec/status
      if (!modalSpec && type === 'spec' && data && typeof data === 'object') {
        modalSpec = data as Schema;
      }
      if (!modalStatus && type === 'status' && data && typeof data === 'object') {
        modalStatus = data as Schema;
      }
      // Wait for next tick to allow modal to render, then focus the element
      setTimeout(() => {
        try {
          const elem = document.getElementById(modalHash);
          if (elem) {
            elem.setAttribute('tabindex', '-1');
            (elem as HTMLElement).focus({ preventScroll: true });
            (elem as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        } catch (e) {
          // ignore
        }
      }, 100);
    } catch (e) {
      modalError = String(e);
    } finally {
      isLoadingModal = false;
    }
  }

  function copyUrl(path: string) {
    const ver = resourceVersion ? `/${resourceName}/${resourceVersion}` : `/${resourceName}`;
    const q = releaseName ? `?release=${encodeURIComponent(releaseName)}` : '';
    const url = `${window.location.origin}${ver}${q}#${path}`;
    return url;
  }

  function closeModal() {
    showResourceModal = false;
    modalSpec = null; modalStatus = null; modalHash = '';
    modalTitleId = null;
    if (typeof window !== 'undefined') {
      try {
        if (prevDocumentTitle !== null) document.title = prevDocumentTitle;
        try { document.body.style.overflow = ''; } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    }
    // reset ulExpanded to nothing
    ulExpanded.set([]);
    // restore previous expand state
    try {
      if (prevExpandAll !== null) expandAll.set(prevExpandAll);
      if (prevExpandAllScope !== null) expandAllScope.set(prevExpandAllScope);
    } catch (e) { /* ignore */ }
    prevExpandAll = null; prevExpandAllScope = null;
  }

  // Handle ESC key to close modal
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && showResourceModal) {
      closeModal();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown);
    onDestroy(() => {
      window.removeEventListener('keydown', handleKeydown);
    });
  }
</script>

<ul class="space-y-1 font-fira text-sm text-gray-800 dark:text-gray-300">
  {#if paths.length === 0}
    <li class="text-xs text-gray-500 dark:text-gray-300">No fields found for this entry.</li>
  {/if}
  {#each paths as p}
    <li class="flex items-start gap-2 justify-between py-1">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <button type="button" class="text-sm text-gray-800 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium hover:underline" on:click={() => openResource(p.path)}>
            <span class="max-w-[70%] break-words">{p.displayPath}{#if p.required}<sup class="text-xs font-bold text-red-500 dark:text-red-400">*</sup>{/if}</span>
          </button>
          {#if p.t}
            {@const typeColor = typeColors[(p.t as unknown) as keyof typeof typeColors] || 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
            <span class="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border {typeColor} font-mono">{p.t}</span>
          {/if}
          <button
            type="button"
            class="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded text-sm font-semibold"
            on:click={(e) => { e.preventDefault(); openResource(p.path); }}
            use:copy={{
              text: copyUrl(p.path),
              onCopy({ event }: any) {
                // Show temporary check mark for this path
                if (timeout) clearTimeout(timeout);
                copiedPath = p.path;
                timeout = setTimeout(() => { if (copiedPath === p.path) copiedPath = null; }, 500);
                const target = event?.target as HTMLElement | null;
                if (target) {
                  target.innerHTML = '&check;';
                  setTimeout(() => { target.innerHTML = '#'; }, 500);
                }
              }
            }}
            title="Open resource and copy link"
          >
            {@html copiedPath === p.path ? '&check;' : '#'}
          </button>
        </div>
        <!-- description removed from YANG view -->
      </div>
      <div class="flex items-center gap-2"></div>
    </li>
  {/each}
</ul>

{#if showResourceModal}
  <!-- Modal overlay -->
  <div use:portal class="fixed inset-0 flex items-center justify-center pointer-events-auto" style="z-index:2147483647;">
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" on:click={closeModal} aria-hidden="true" style="z-index:2147483646;"></div>
    <div role="dialog" aria-modal="true" aria-labelledby={modalTitleId} class="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl overflow-hidden max-w-6xl w-full mx-4 sm:mx-6 md:mx-8" style="z-index:2147483647;">
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <div class="flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-sm">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <div class="min-w-0">
              <h2 id={modalTitleId} class="text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100">{stripResourcePrefixFQDN(resourceName)}{resourceVersion ? ` ${resourceVersion}` : ''}</h2>
              <div id={`${modalTitleId}-subtitle`} class="text-xs text-gray-500 dark:text-gray-400">{releaseName ? releaseName : ''}</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            {#if isLoadingModal}
              <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
            {/if}
            {#if modalError}
              <div class="text-xs text-red-600 dark:text-red-400">{modalError}</div>
            {/if}
            <button class="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200" on:click={closeModal}>Close</button>
            <button class="text-xs px-3 py-1 rounded bg-cyan-600 text-white" on:click={() => {
                const verPath = resourceVersion ? `/${resourceVersion}` : '';
                const url = `/${resourceName}${verPath}${releaseName ? `?release=${encodeURIComponent(releaseName)}` : ''}`;
                window.open(url, '_blank');
              }}>Open</button>
            <button
              class="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              on:click={() => {
                try {
                  expandAllScope.set('global');
                  expandAll.update(v => !v);
                } catch (e) { /* ignore */ }
              }}
            >{ $expandAll ? 'Collapse All' : 'Expand All' }</button>
          </div>
      </div>
      <div class="p-3 md:p-4 flex flex-col gap-4 max-h-[70vh] overflow-auto bg-white dark:bg-gray-900">
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-2 md:p-3 bg-gray-50 dark:bg-gray-800">
          <div class="text-xs font-semibold text-cyan-600 dark:text-cyan-400 mb-2">SPEC</div>
          {#if modalSpec}
            <Render hash={modalHash} source={releaseName || 'release'} type={'spec'} data={modalSpec} showType={false} />
          {:else}
            <div class="text-xs text-gray-500">No spec available</div>
          {/if}
        </div>
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-2 md:p-3 bg-gray-50 dark:bg-gray-800">
          <div class="text-xs font-semibold text-green-600 dark:text-green-400 mb-2">STATUS</div>
          {#if modalStatus}
            <Render hash={modalHash} source={releaseName || 'release'} type={'status'} data={modalStatus} showType={false} />
          {:else}
            <div class="text-xs text-gray-500">No status available</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
