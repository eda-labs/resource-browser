<script lang="ts">
  import { page } from "$app/stores"

	import Footer from "$lib/components/Footer.svelte"
	import Navbar from "$lib/components/Navbar.svelte"
  import Render from "$lib/components/Render.svelte"

  import { expandAll, expandAllScope, ulExpanded } from '$lib/store'

  export let data
  let { name, versionOnFocus, kind, group, deprecated, validVersions, spec, status } = data

  const hash = $page.url.hash?.substring(1)

  expandAll.set(false)
  expandAllScope.set("local")
  ulExpanded.set([])

  function handleGlobalExpand() {
    expandAllScope.set("global")
    if($ulExpanded.length > 0) {
      expandAll.set(false)
    } else {
      expandAll.set(true)
    }
  }
</script>

<Navbar {name} {versionOnFocus} {kind} {group} {deprecated} {validVersions} />
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
  <Render {hash} source={"eda"} type={"spec"} data={spec} />
  <hr class="my-2 text-gray-300 dark:text-gray-600"/>
  <Render {hash} source={"eda"} type={"status"} data={status} />
</div>

<Footer home={false}/>