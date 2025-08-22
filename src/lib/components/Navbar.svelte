<script lang="ts">
	import Theme from "./Theme.svelte"

  export let name: string
  export let kind: string
  export let group: string
  export let versionOnFocus: string
  export let validVersions: string[]
  export let deprecated: boolean

  function handleVersionChange(event: Event) {
    const select = event.target as HTMLSelectElement
    const changedVersion = select.value
    window.location.href = `/${name}/${changedVersion}`
  }
</script>

<nav class="fixed top-0 z-20 pl-6 pr-4 py-4 w-screen font-nunito text-black dark:text-white backdrop-filter backdrop-blur-lg border-b border-gray-300 dark:border-gray-700">
  <div class="flex items-center justify-between">
    <div class="flex items-center space-x-2 overflow-x-auto scroll-light dark:scroll-dark">
      <a href="/"><img class="min-w-8" src="/images/eda.png" width="35" alt="Logo"/></a>
      <div class="flex flex-col">
        <p class="text-lg">{kind}</p>
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
          {#if deprecated}
            <span class="ml-2 px-2 py-1 text-[10px] rounded-lg bg-orange-200 dark:bg-orange-500 text-gray-800">deprecated</span>
          {/if}
        </div>
      </div>
    </div>
    <Theme/>
  </div>
</nav>