<script lang="ts">
  import { expandAll, expandAllScope, ulExpanded } from './store'
	import { getDescription, getScope } from "./functions"

  export let key: string
  export let folder: any
  export let requiredList: string[]
  export let parent: string

  let expanded: boolean = false

  function updateExpandedList() {
    const clickedElement = `${parent}.${key}`
    if(expanded) {
      ulExpanded.update(arr => [...arr, clickedElement])
    } else {
      ulExpanded.update(arr => arr.filter(x => x.indexOf(clickedElement) === -1))
    }
  }

  $: {
    if($expandAllScope === "global") {
      expanded = $expandAll
      expandAllScope.set("global")
      updateExpandedList()
    }
  }

  function handleLocalExpand() {
    expanded = !expanded
    expandAllScope.set("local")
    updateExpandedList()
  }

  function propExist() {
    const scope = getScope(folder)
    if(!('properties' in scope)) {
      scope["properties"] = getDescription(scope)
    }
    return scope.properties
  }
</script>

<li class="pt-1">
  <button class="px-1 pt-2 group text-gray-800 dark:text-gray-200 flex items-center space-x-2 cursor-pointer overflow-x-auto" 
      on:click={handleLocalExpand}>
    <svg class="w-3 h-3 group-hover:text-gray-400 transition-transform duration-200 svg-arrow {expanded ? 'rotate-90' : ''}"
        fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
    </svg>
    <span class="group-hover:text-blue-500">{key}</span>
    <span class="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">{folder.type}</span>
    {#if requiredList.includes(key)}
      <span class="px-2 py-0.5 bg-gray-400 text-gray-900 dark:text-gray-800 rounded text-[10px]">required</span>
    {/if}
  </button>
  {#if expanded}
    <ul class="ml-2 px-3 pt-2 dark:bg-gray-800 border-l border-gray-300 dark:border-gray-600">
      <li class="px-1 text-gray-400 dark:text-gray-500 text-sm font-nunito">{getDescription(folder)}</li>
      {#if folder.type === "object" || folder.type === "array"}
        {#each Object.entries(propExist()) as [subkey, subfolder]}
          {@const requiredList = getScope(folder).required || []}
          <svelte:self key={subkey} folder={subfolder} {requiredList} parent={`${parent}.${key}`} />
        {/each}
      {/if}
    </ul>
  {/if}
</li>