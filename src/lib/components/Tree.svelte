<script lang="ts">
  import { copy } from 'svelte-copy'

  import { expandAll, expandAllScope, ulExpanded } from '$lib/store'
	import { getDescription, getScope, hashExistDeep } from "./functions"
	import type { Schema } from '$lib/structure'

  export let hash: string
  export let source: string
  export let key: string
  export let folder: Schema
  export let requiredList: string[] = []
  export let parent: string
  export let expanded: boolean
  export let borderColor: string

  let currentId = `${parent}.${key}`
  let timeout: ReturnType<typeof setTimeout>

  function handleLocalExpand() {
    expanded = !expanded
    expandAllScope.set("local")
  }

  function propExist() {
    const scope = getScope(folder)
    if(!('properties' in scope)) {
      scope["properties"] = getDescription(scope)
    }
    return scope.properties
  }

  function updateHash(newHash: string) {
    location.hash = newHash
    window.location.reload()
	}

  $: {
    if($expandAllScope === "global") {
      expanded = $expandAll
      expandAllScope.set("global")
    }
  }

  $: {
    if(expanded) {
      ulExpanded.update(arr => [...arr, currentId])
    } else {
      ulExpanded.update(arr => arr.filter(x => x.indexOf(currentId) === -1))
    }
  }
</script>

<li id="{currentId}" class="pt-1 scroll-mt-[80px]">
  <div class="px-1 pt-2 flex items-center space-x-2 group">
    <button class="text-gray-800 dark:text-gray-200 flex items-center space-x-2 cursor-pointer overflow-x-auto scroll-light dark:scroll-dark" 
      on:click={handleLocalExpand}>
      <svg class="w-3 h-3 group-hover:text-gray-400 text-gray-800 dark:text-gray-200 transition-transform duration-200 svg-arrow {expanded ? 'rotate-90' : ''}"
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <span class="group-hover:text-blue-500 {hash === currentId ? 'text-green-600 dark:text-green-500' : ''}">{key}{#if requiredList.includes(key)}<sup class="text-red-400 dark:text-red-500 text-xs">*</sup>{/if}</span>
      {#if "type" in folder}
        <span class="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">{folder.type}</span>
      {/if}
    </button>
    {#if source !== "uploaded"}
      <a href={`#${currentId}`} class="text-gray-400 dark:text-gray-500 cursor-pointer hidden group-hover:block group-active:block hover:text-gray-700 dark:hover:text-gray-300" use:copy={{
        text: window.location.origin + window.location.pathname + `#${currentId}`,
        onCopy({event}) {
          event.target.innerHTML = "&check;"
          timeout = setTimeout(() => {
            event.target.innerHTML = "#"
          }, 500)
        }
      }}>#</a>
    {/if}
  </div>
  {#if expanded}
    <ul class="ml-[9px] px-3 pt-2 dark:bg-gray-800 border-l {borderColor}">
      <li class="px-1 text-gray-400 dark:text-gray-500 text-sm font-nokia font-light">{getDescription(folder)}</li>
      {#if folder.type === "object" || folder.type === "array"}
        {@const props = propExist()}
        {#if typeof props === "object"}
          {#each Object.entries(props) as [subkey, subfolder]}
            {@const scope = getScope(folder)}
            {@const requiredList = ('required' in scope ? scope.required : [])}
            <svelte:self {hash} {source} {borderColor} key={subkey} folder={subfolder} {requiredList} parent={currentId} expanded={hashExistDeep(hash, `${currentId}.${subkey}`)} />
          {/each}
        {/if}
      {/if}
    </ul>
  {/if}
</li>