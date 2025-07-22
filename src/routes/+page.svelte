<script lang="ts">
  import { derived, writable } from 'svelte/store'

	import Footer from '$lib/components/Footer.svelte'

	import type { CrdVersionsMap } from '$lib/structure'

  import yaml from 'js-yaml'
  import res from '$lib/resources.yaml?raw'
  const crdResources = yaml.load(res) as CrdVersionsMap
	
  const resourceStore = writable(crdResources)
  const resourceSearch = writable("")

  const resourceNameStore = derived(resourceStore, $resourceStore => Object.keys($resourceStore))
  const resourceSearchFilter = derived([resourceSearch, resourceNameStore], ([$resourceSearch, $resourceNameStore]) => 
    $resourceNameStore.filter(x => $resourceSearch.split(/\s+/).every(y => x.includes(y))))
</script>

<div class="flex flex-col min-h-screen has-header-img font-nunito">
  <div class="flex grow items-center mx-auto px-8 md:px-14 py-10">
    <div class="grid grid-cols-1 md:grid-cols-2 items-center gap-5">
      <div>
        <p class="mb-4"><img src="/images/eda.png" width="60" alt="Logo" /></p>
        <h3 class="text-3xl text-yellow-300 font-light mt-6">EDA Resource Browser</h3>
        <div class="text-gray-300 mt-2 max-w-[500px] text-sm">
          <p>View Custom Resource Definitions (CRD)</p>
        </div>
        <!--<a class="px-2 py-2 rounded-lg text-nowrap text-center text-white bg-gray-600 hover:bg-gray-700" href="/uploads">Uploads</a>-->
      </div>
      <div class="bg-gray-100 dark:bg-gray-800 rounded-lg shadow-xl pb-1.5">
        <div class="p-3 border-b border-gray-300 dark:border-gray-600">
          <input type="text" placeholder="Search..." bind:value={$resourceSearch} 
            class="px-3 py-2 rounded-lg w-full text-[12.5px] text-gray-800 dark:text-gray-200 
              dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
        </div>
				<div class="h-[280px] max-w-[380px] lg:w-[380px] overflow-y-auto scroll-light dark:scroll-dark">
          <ul>
            {#each $resourceSearchFilter as resource, i}
              {@const resDef = $resourceStore[resource]}
              {@const targetVersion = resDef.versions[0]}
              <li class="text-gray-900 hover:bg-gray-200 {i > 0 ? 'border-t border-gray-300 dark:border-gray-600' : ''} dark:hover:bg-gray-700">
                <a class="flex flex-col px-4 py-3" href={`${resource}_${targetVersion}`}>
                  <span class="text-sm dark:text-gray-200 overflow-x-auto scroll-light dark:scroll-dark">{resDef.kind}</span>
                  <span class="text-sm dark:text-gray-200 overflow-x-auto scroll-light dark:scroll-dark">{resDef.group}</span>
                </a>
              </li>
            {/each}
          </ul>
				</div>
			</div>
    </div>
  </div>
  <div class="shrink-0">
    <Footer home={true} />
  </div>
</div>
