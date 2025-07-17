<script lang="ts">
  import { onMount } from 'svelte'
  import { derived, writable } from 'svelte/store'

	import Footer from '$lib/components/Footer.svelte'

	import type { CrdVersionsMap, OpenAPISchema, VersionSchema } from '$lib/structure'
  import crdResources from '$lib/resources.json'
	
  let currentPanel = "upload"
  let files: FileList
  let crdUploaded: { versions: VersionSchema; name: string; }

  async function handleUpload() {
    if(files) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const crd = JSON.parse(text);

          const group = crd.spec.group
          const kind = crd.spec.names.kind
          const name = `${kind.toLowerCase()}.${group}`
          const versions: VersionSchema = {}

          crd.spec.versions.forEach((x: OpenAPISchema) => {
            versions[x.name] = {
              spec: x.schema.openAPIV3Schema.properties.spec,
              status: x.schema.openAPIV3Schema.properties.status
            }
          })

          localStorage.setItem('crdUploaded', JSON.stringify({name, group, kind, versions}))
          window.alert(`[Success] File uploaded. Page will be reload to take effect.`)
        } catch (err) {
          window.alert(`[Error] Failed to upload file: ${err}`)
        }
        window.location.reload()
      }
      reader.readAsText(files[0])
    }
  }

  const resourceStore = writable<CrdVersionsMap>(crdResources)
  const resourceSearch = writable("")

  const resourceNameStore = derived(resourceStore, $resourceStore => Object.keys($resourceStore))
  const resourceSearchFilter = derived([resourceSearch, resourceNameStore], ([$resourceSearch, $resourceNameStore]) => 
    $resourceNameStore.filter(x => $resourceSearch.split(/\s+/).every(y => x.includes(y))))

  onMount(() => {
    const stored = localStorage.getItem("crdUploaded");
    if(stored) {
      crdUploaded = JSON.parse(stored)
    }
  })
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
        <!--<a class="px-2 py-2 rounded-lg text-nowrap text-center text-white bg-gray-600 hover:bg-gray-700" href="/offline">Custom CRD</a>-->
      </div>
      <div class="bg-gray-100 dark:bg-gray-800 rounded-lg shadow-xl pb-1.5">
        <div class="p-3 rounded-t border-b border-gray-300 dark:border-gray-600">
					<ul class="flex flex-wrap text-sm font-medium text-center text-gray-500 dark:text-gray-400">
						<li class="mr-2">
              <button class="inline-block px-3 py-1 rounded-lg cursor-pointer {currentPanel === "product"
                ? 'bg-blue-600 text-white dark:bg-gray-200 dark:text-gray-800'
                : 'hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-blue-600 dark:hover:text-white'}"
                  on:click={() => currentPanel = "product"}>
                Product
              </button>
            </li>
            <!--<li class="mr-2">
              <button class="inline-block px-3 py-1 rounded-lg cursor-pointer {currentPanel === "upload"
                ? 'bg-blue-600 text-white dark:bg-gray-200 dark:text-gray-800'
                : 'hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-blue-600 dark:hover:text-white'}"
                  on:click={() => currentPanel = "upload"}>
                Upload
              </button>
            </li>-->
					</ul>
				</div>
        {#if currentPanel === "product"}
          <div class="p-3 border-b border-gray-300 dark:border-gray-600">
            <input type="text" placeholder="Search..." bind:value={$resourceSearch} 
              class="px-3 py-2 rounded-lg w-full text-[12.5px] text-gray-800 dark:text-gray-200 
                dark:placeholder-gray-400 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
          </div>
        {/if}
				<div class="h-[280px] max-w-[450px] lg:w-[450px] overflow-y-auto scroll-light dark:scroll-dark">
          {#if currentPanel === "product"}
            <ul>
              {#each $resourceSearchFilter as resource, i}
                <li class="items-center text-gray-900 hover:bg-gray-200 {i > 0 ? 'border-t border-gray-300 dark:border-gray-600' : ''} dark:hover:bg-gray-700">
                  <a href={`${resource}_${$resourceStore[resource][0]}`}>
                    <p class="px-4 py-3 text-sm dark:text-gray-200 overflow-x-auto scroll-light dark:scroll-dark">{resource}</p>
                  </a>
                </li>
              {/each}
            </ul>
          {:else if currentPanel === "upload"}
            <div class="p-2 border-b border-gray-300 dark:border-gray-600">
              <input id="dropzone" type="file" class="peer hidden" accept="application/json" bind:files on:change={handleUpload} />
              <label for="dropzone" class="flex flex-col items-center px-4 py-3 cursor-pointer rounded-lg text-gray-500 dark:text-gray-400 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 border-2 border-dashed border-gray-200 dark:border-gray-700">
                <div class="flex items-center space-x-2">
                  <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v9m-5 0H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2M8 9l4-5 4 5m1 8h.01"/>
                  </svg>                
                  <p class="text-sm">Click to upload a CRD</p>
                </div>
                <div class="mt-2">
                  <p class="text-xs">Supported file format .json (max 10 MB)</p>
                </div>
              </label>
            </div>
            {#if crdUploaded}
              {@const uploadedVersionOnFocus = Object.keys(crdUploaded.versions)[0]}
              <div class="bg-gray-300 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-gray-200">
                <a class="text-center" href={`uploaded-${crdUploaded.name}_${uploadedVersionOnFocus}`}>
                  <p class="px-4 py-3 text-sm overflow-x-auto scroll-light dark:scroll-dark">{crdUploaded.name}</p>
                </a>
              </div>
            {/if}
          {/if}
				</div>
			</div>
    </div>
  </div>
  <div class="shrink-0">
    <Footer home={true} />
  </div>
</div>
