<script lang="ts">
	import type { Schema } from "$lib/structure"
	import { getDescription, getScope, hashExistDeep } from "./functions"
  
	import Tree from "./Tree.svelte"

  export let hash: string = ""
  export let source: string
  export let type: string
  export let data: Schema

  const desc = getDescription(data)
  const scope = getScope(data)
</script>

<p class="py-1 mb-0 text-gray-800 dark:text-gray-200 text-sm">{type.toUpperCase()}</p>
<ul class="ml-2 px-3 dark:bg-gray-800 border-l border-gray-300 dark:border-gray-600">
  <li class="px-1 pt-1.5 text-gray-400 dark:text-gray-500 text-sm">{desc}</li>
  {#if 'properties' in scope}
    <div class="font-fira">
      {#each Object.entries(scope.properties) as [key, folder]}
        {@const requiredList = ('required' in scope ? scope.required : [])}
        <Tree {hash} {source} {key} {folder} {requiredList} parent={type} expanded={hashExistDeep(hash, `${type}.${key}`)} />
      {/each}
    </div>
  {/if}
</ul>