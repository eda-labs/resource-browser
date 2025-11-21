<script lang="ts">
  import { copy } from 'svelte-copy';
  import { getScope, getDescription, getFormat, getDefault, getEnum } from './functions';
  import type { Schema } from '$lib/structure';

  export let hash: string = '';
  export let source: string = '';
  export let type: string = '';
  export let data: Schema;
  export let resourceName: string = '';
  export let resourceVersion: string | null = null;
  export let releaseName: string | null = null;

  function joinPath(prefix: string, piece: string) {
    if (!prefix) return piece;
    return `${prefix}.${piece}`;
  }

  type YangPath = {
    path: string;
    displayPath: string;
    t?: string;
    desc?: string;
    format?: string;
    def?: string;
    enum?: string[];
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
            desc: getDescription(v as Schema) || undefined,
            format: getFormat(v as Schema) || undefined,
            def: getDefault(v as Schema) || undefined,
            enum: getEnum(v as Schema) || undefined
            ,
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
              t: 'array',
              desc: getDescription(thisScope.items as Schema) || undefined,
              format: getFormat(thisScope.items as Schema) || undefined,
              def: getDefault(thisScope.items as Schema) || undefined,
              enum: getEnum(thisScope.items as Schema) || undefined
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

  const paths = data ? collectPaths(data, '') : [];

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

  function openResource(path: string) {
    const ver = resourceVersion ? `/${resourceName}/${resourceVersion}` : `/${resourceName}`;
    const q = releaseName ? `?release=${encodeURIComponent(releaseName)}` : '';
    const url = `${window.location.origin}${ver}${q}#${path}`;
    window.open(url, '_blank');
  }

  function copyUrl(path: string) {
    const ver = resourceVersion ? `/${resourceName}/${resourceVersion}` : `/${resourceName}`;
    const q = releaseName ? `?release=${encodeURIComponent(releaseName)}` : '';
    const url = `${window.location.origin}${ver}${q}#${path}`;
    return url;
  }
</script>

<ul class="space-y-1">
  {#if paths.length === 0}
    <li class="text-xs text-gray-500">No fields found for this entry.</li>
  {/if}
  {#each paths as p}
    <li class="flex items-start gap-2 justify-between py-1">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <button class="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline" on:click={() => openResource(p.path)}>
            <span class="max-w-[70%] break-words">{p.displayPath}{#if p.required}<sup class="text-xs font-bold text-red-500 dark:text-red-400">*</sup>{/if}</span>
          </button>
          {#if p.t}
            {@const typeColor = typeColors[p.t] || 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
            <span class="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border {typeColor} font-mono">{p.t}</span>
          {/if}
          <a
            href={() => '#'}
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
          </a>
        </div>
        {#if p.desc}
          <div class="text-xs text-gray-500 mt-0.5">{p.desc}</div>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if p.def}
          <div class="text-xs text-gray-600 dark:text-gray-300 font-mono px-2 py-0.5 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">{p.def}</div>
        {/if}
        {#if p.enum}
          <div class="text-xs text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20">{p.enum}</div>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
