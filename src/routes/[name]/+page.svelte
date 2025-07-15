<script lang="ts">
	import Footer from "$lib/components/Footer.svelte"
	import Navbar from "$lib/components/Navbar.svelte"
	import Tree from "./Tree.svelte"

  import { expandAll, expandAllScope, ulExpanded } from './store'
  import { getDescription, getScope } from "./functions"

  export let data
  let { group, kind, versions } = data

  const validVersions = Object.keys(versions)
  let versionOnFocus = validVersions[0]

  $: spec = versions[versionOnFocus].spec
  $: status = versions[versionOnFocus].status

  function handleGlobalExpand() {
    expandAllScope.set("global")
    if($ulExpanded.length > 0) {
      expandAll.set(false)
    } else {
      expandAll.set(true)
    }
  }
</script>

<Navbar {group} {kind} {validVersions} bind:versionOnFocus />
<div class="pt-[100px] px-6 pb-6 space-y-4">
  <div class="flex items-center space-x-2">
    <button class="px-2 py-1 text-xs rounded-lg cursor-pointer border 
        {$ulExpanded.length > 0 
          ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white border-gray-300 dark:border-gray-600' 
          : 'text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-600 border-blue-600 dark:border-blue-700'}"
      on:click={handleGlobalExpand}>
      {$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} All
    </button>
  </div>
  <p class="py-1 mb-0 text-gray-800 dark:text-gray-200 text-sm">SPEC</p>
  <ul class="ml-2 px-3 dark:bg-gray-800 border-l border-gray-300 dark:border-gray-600">
    <li class="px-1 pt-1.5 text-gray-400 dark:text-gray-500 text-sm font-nunito">{getDescription(spec)}</li>
    <div class="font-fira">
      {#each Object.entries(getScope(spec).properties) as [key, folder]}
        {@const requiredList = getScope(spec).required || []}
        <Tree {key} {folder} {requiredList} parent={"spec"} />
      {/each}
    </div>
  </ul>
  <hr class="my-2 text-gray-300 dark:text-gray-600"/>
  <p class="py-1 mb-0 text-gray-800 dark:text-gray-200 text-sm">STATUS</p>
  <ul class="ml-2 px-3 dark:bg-gray-800 border-l border-gray-300 dark:border-gray-600">
    <li class="px-1 pt-1.5 text-gray-400 dark:text-gray-500 text-sm font-nunito">{getDescription(status)}</li>
    <div class="font-fira">
      {#each Object.entries(getScope(status).properties) as [key, folder]}
        {@const requiredList = getScope(status).required || []}
        <Tree {key} {folder} {requiredList} parent={"status"} />
      {/each}
    </div>
  </ul>
</div>

<Footer home={false}/>