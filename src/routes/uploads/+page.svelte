<script lang="ts">
  import yaml from 'js-yaml'

  import Footer from '$lib/components/Footer.svelte'
  import Theme from '$lib/components/Theme.svelte'
  import Render from '$lib/components/Render.svelte'

	import type { OpenAPISchema, Schema, VersionSchema } from '$lib/structure'
  import { expandAll, expandAllScope, ulExpanded } from '$lib/store'

  let files: FileList

  expandAll.set(false)
  expandAllScope.set("local")
  ulExpanded.set([])

  let kind = ""
  let group = ""
  let versions: VersionSchema = {}
  let spec: Schema
  let status: Schema

  let validVersions: string[] = []
  let versionOnFocus: string = ""

  async function handleUpload() {
    if(files) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const crd = yaml.load(text)

          group = crd.spec.group
          kind = crd.spec.names.kind

          crd.spec.versions.forEach((x: OpenAPISchema) => {
            versions[x.name] = {
              spec: x.schema.openAPIV3Schema.properties.spec,
              status: x.schema.openAPIV3Schema.properties.status
            }
          })

          validVersions = Object.keys(versions)
          versionOnFocus = validVersions[0]
          spec = versions[versionOnFocus].spec
          status = versions[versionOnFocus].status

          window.alert(`[Success] File uploaded.`)
        } catch (err) {
          window.alert(`[Error] Failed to upload file: ${err}`)
        }
      }
      reader.readAsText(files[0])
    }
  }

  function handleGlobalExpand() {
    expandAllScope.set("global")
    if($ulExpanded.length > 0) {
      expandAll.set(false)
    } else {
      expandAll.set(true)
    }
  }

  function handleVersionChange(event: Event) {
    const select = event.target as HTMLSelectElement
    const versionOnFocus = select.value
    spec = versions[versionOnFocus].spec
    status = versions[versionOnFocus].status
  }
</script>

<nav class="fixed top-0 z-20 pl-6 pr-4 py-4 w-screen font-nunito text-black dark:text-white backdrop-filter backdrop-blur-lg border-b border-gray-300 dark:border-gray-700">
  <div class="flex items-center justify-between">
    <div class="flex items-center space-x-2 overflow-x-auto scroll-light dark:scroll-dark">
      <a href="/"><img class="min-w-8" src="/images/eda.png" width="35" alt="Logo"/></a>
      <div class="flex flex-col">
        <p class="text-sm">Resource Browser</p>
        <p class="text-xs">Uploads</p>
      </div>
    </div>
    <Theme/>
  </div>
</nav>
<div class="pt-[100px] px-6 pb-6 space-y-4">
  <div>
    <input id="dropzone" type="file" class="peer hidden" accept="application/yaml" bind:files on:change={handleUpload} />
    <label for="dropzone" class="flex items-center justify-center px-4 py-3 cursor-pointer rounded-lg text-gray-500 dark:text-gray-400 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 border-2 border-dashed border-gray-200 dark:border-gray-700">
      <div class="flex items-center space-x-2 pr-2">
        <svg class="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v9m-5 0H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2M8 9l4-5 4 5m1 8h.01"/>
        </svg>                
        <p class="text-sm">Click to upload a CRD</p>
      </div>
      <div class="pl-2 border-l border-gray-400 dark:border-gray-700">
        <p class="text-xs">Supported file format .yaml (max 10 MB)</p>
        <p class="text-xs text-yellow-600 dark:text-yellow-500">Note: Page reload resets the uploaded data</p>
      </div>
    </label>
  </div>
  {#if kind !== ""}
    <div class="flex flex-col">
      <p class="text-gray-800 dark:text-gray-200">{kind}</p>
      <div class="text-sm text-gray-500 dark:text-gray-400 font-fira flex items-center">
        <span>{group}</span>
        <span>/</span>
        {#if validVersions.length > 1}
          <select class="p-[1px] rounded-lg text-xs focus:outline-none focus:ring-0 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-gray-700" 
              bind:value={versionOnFocus} on:change={handleVersionChange}>
            {#each validVersions as version}
              <option value="{version}">{version}</option>
            {/each}
          </select>
        {:else}
          <span>{validVersions[0]}</span>
        {/if}
      </div>
    </div>
    <div class="flex items-center space-x-2">
      <button class="px-2 py-1 text-xs rounded-lg cursor-pointer border 
          {$ulExpanded.length > 0 
            ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white border-gray-300 dark:border-gray-600' 
            : 'text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-600 border-blue-600 dark:border-blue-700'}"
        on:click={handleGlobalExpand}>
        {$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} All
      </button>
    </div>
    <Render source={"uploaded"} type={"spec"} data={spec} />
    <hr class="my-2 text-gray-300 dark:text-gray-600"/>
    <Render source={"uploaded"}} type={"status"} data={status} />
  {/if}
</div>

<Footer home={false}/>
