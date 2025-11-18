<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	export let name: string;
	export let versionOnFocus: string;
	export let validVersions: string[];
	export let deprecated: boolean;
	// 'sidebarOpen' was unused here — removed to prevent Svelte compile warnings

	// Extract short name and group path from full name
	$: shortName = name.split('.')[0];
	$: groupPath = name.split('.').slice(1).join('.');

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const changedVersion = select.value;
		// Use goto with preserve to avoid full page reload and keep sidebar state
		const currentRelease = $page.url.searchParams.get('release');
		const url = currentRelease 
			? `/${name}/${changedVersion}?release=${currentRelease}`
			: `/${name}/${changedVersion}`;
		goto(url, { replaceState: false, keepFocus: true });
	}
</script>

<nav
	class="fixed top-0 z-20 w-screen border-b border-white/10 bg-black/40 backdrop-blur-xl shadow-md"
>
	<div class="mx-auto max-w-full px-4 py-3 pl-16 sm:px-6 lg:pl-20">
		<div class="flex items-center justify-between gap-6">
			<!-- Left side - Resource Info -->
			<div class="flex items-center gap-4 min-w-0 flex-1">
				<!-- Resource Info -->
				<div class="min-w-0">
					<h1 class="text-xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 font-nokia-headline leading-tight truncate">
						{shortName}
					</h1>
					<p class="text-sm sm:text-base text-gray-500 dark:text-gray-300 font-medium mt-1 truncate">
						{groupPath}
					</p>
				</div>
				
				<!-- Version -->
				<div class="flex items-center gap-2 px-2 py-1 sm:px-4 sm:py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 shrink-0">
					<svg class="h-3 w-3 sm:h-4 sm:w-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
					</svg>
					{#if validVersions.length > 1}
						<select
							class="select-pro text-xs sm:text-sm font-bold text-blue-700 dark:text-blue-300 bg-transparent font-nokia-text"
							bind:value={versionOnFocus}
							on:change={handleVersionChange}
						>
							{#each validVersions as version}
								<option value={version} class="bg-white dark:bg-gray-800">{version}</option>
							{/each}
						</select>
					{:else}
						<span class="text-xs sm:text-sm font-bold text-blue-700 dark:text-blue-300 font-nokia-text">{validVersions[0]}</span>
					{/if}
				</div>
				
				{#if deprecated}
					<div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 shrink-0">
						<svg class="h-4 w-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
						<span class="text-xs font-bold text-orange-700 dark:text-orange-400 font-nokia-text">DEPRECATED</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</nav>