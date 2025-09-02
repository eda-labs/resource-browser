<script lang="ts">
	import Theme from './Theme.svelte';

	export let name: string;
	export let kind: string;
	export let group: string;
	export let versionOnFocus: string;
	export let validVersions: string[];
	export let deprecated: boolean;
	export let appVersion: string;

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const changedVersion = select.value;
		window.location.href = `/${name}/${changedVersion}`;
	}
</script>

<nav
	class="fixed top-0 z-20 w-screen border-b border-gray-300 py-4 pr-4 pl-6 text-black backdrop-blur-lg backdrop-filter dark:border-gray-700 dark:text-white"
>
	<div class="flex items-center justify-between">
		<div class="flex min-w-0 items-center space-x-2">
			<a href="/"><img class="min-w-9 max-w-9" src="/images/eda.svg" width="35" alt="Logo" /></a>
			<div class="scroll-thin flex flex-col overflow-x-auto">
				<p class="text-lg font-nokia-headline">{kind}</p>
				<div class="font-fira flex items-center text-[12px] text-gray-500 dark:text-gray-400">
					{#if appVersion !== ''}
						<span class="dropdown">
							<button class="dropdown-button cursor-pointer border-b border-dashed">{group}</button>
							<div
								class="dropdown-content absolute z-10 hidden rounded-lg bg-gray-100 shadow dark:bg-gray-700 dark:text-white"
							>
								<p class="my-2 px-2 text-xs">
									App version: {appVersion}
								</p>
							</div>
						</span>
					{:else}
						<span>{group}</span>
					{/if}
					<span class="mx-0.5">/</span>
					{#if validVersions.length > 1}
						<select
							class="rounded-lg border border-gray-300 bg-gray-50 p-[1px] text-xs text-gray-900 focus:ring-0 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
							bind:value={versionOnFocus}
							on:change={handleVersionChange}
						>
							{#each validVersions as version}
								<option value={version}>{version}</option>
							{/each}
						</select>
					{:else}
						<span>{validVersions[0]}</span>
					{/if}
					{#if deprecated}
						<span
							class="ml-2 rounded-lg bg-orange-200 px-2 py-[3px] text-[10px] text-gray-800 dark:bg-orange-500"
							>deprecated</span
						>
					{/if}
				</div>
			</div>
		</div>
		<Theme />
	</div>
</nav>
