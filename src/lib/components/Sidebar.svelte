<script lang="ts">
	import { writable, derived } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import yaml from 'js-yaml';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';
	import { onMount } from 'svelte';
	
	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
	const defaultRelease = releasesConfig.releases.find(r => r.default) || releasesConfig.releases[0];
	
	export const selectedRelease = writable<EdaRelease>(defaultRelease);
	export const crdMetaStore = writable<CrdResource[]>([]);
	const resourceSearch = writable('');
	
	// Mobile menu state
	let isMobileMenuOpen = false;
	
	// Load CRDs dynamically for the selected release
	async function loadCrdsForRelease(release: EdaRelease) {
		try {
			const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
			if (manifestResponse.ok) {
				const manifest = await manifestResponse.json();
				crdMetaStore.set(manifest);
				return;
			}
		} catch (e) {
			// No manifest file found, loading from resources.yaml (fallback)
		}
		
		try {
			const res = await import('$lib/resources.yaml?raw');
			const resources = yaml.load(res.default) as any;
			const crdMeta = Object.values(resources).flat() as CrdResource[];
			crdMetaStore.set(crdMeta);
		} catch (e) {
			console.error('Failed to load resources:', e);
			crdMetaStore.set([]);
		}
	}
	
	$: loadCrdsForRelease($selectedRelease);
	
	const resourceSearchFilter = derived(
		[resourceSearch, crdMetaStore],
		([$resourceSearch, $crdMetaStore]) => {
			const query = $resourceSearch.toLowerCase();
			return $crdMetaStore.filter((x) =>
				query.split(/\s+/).every((term) => x.name.includes(term))
			);
		}
	);
	
	onMount(() => {
		// Check if a specific release is requested
		const urlParams = new URLSearchParams(window.location.search);
		const releaseParam = urlParams.get('release');
		if (releaseParam) {
			const foundRelease = releasesConfig.releases.find(r => r.name === releaseParam);
			if (foundRelease) {
				selectedRelease.set(foundRelease);
			}
		}
	});
	
	function handleReleaseChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const newReleaseName = select.value;
		const newRelease = releasesConfig.releases.find(r => r.name === newReleaseName);
		if (newRelease) {
			selectedRelease.set(newRelease);
			
			// Check if we're on a detail page
			const currentPath = window.location.pathname;
			const isDetailPage = currentPath !== '/' && currentPath.includes('/');
			
			if (isDetailPage) {
				// Extract current resource name from URL
				const pathParts = currentPath.split('/').filter(p => p);
				if (pathParts.length >= 1) {
					const currentResourceName = pathParts[0];
					// Try to navigate to the same resource in the new release
					// Note: We'll need to wait for the manifest to load first
					setTimeout(() => {
						const resourceInNewRelease = $crdMetaStore.find(r => r.name === currentResourceName);
						if (resourceInNewRelease) {
							// Resource exists in new release, navigate to it
							goto(`/${currentResourceName}/${resourceInNewRelease.versions[0].name}?release=${newRelease.name}`);
						} else {
							// Resource doesn't exist in new release, go to browse mode
							goto(`/?browse=true&release=${newRelease.name}`);
						}
					}, 300); // Wait for manifest to load
					return;
				}
			}
			
			// Default: redirect to homepage in browse mode
			goto(`/?browse=true&release=${newRelease.name}`);
		}
	}
	
	function handleResourceClick(resource: string, resDef: CrdResource) {
		goto(`/${resource}/${resDef.versions[0].name}?release=${$selectedRelease.name}`);
		// Close mobile menu after navigation
		isMobileMenuOpen = false;
	}
	
	function toggleMobileMenu() {
		isMobileMenuOpen = !isMobileMenuOpen;
	}
	
	function closeMobileMenu() {
		isMobileMenuOpen = false;
	}
</script>

<!-- Hamburger Button (Mobile Only) - Shows hamburger/X toggle -->
<button
	on:click={toggleMobileMenu}
	class="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
	aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
>
	<svg
		class="h-5 w-5 text-gray-700 dark:text-gray-200"
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		{#if isMobileMenuOpen}
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		{:else}
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
		{/if}
	</svg>
</button>

<!-- Overlay (Mobile Only) -->
{#if isMobileMenuOpen}
	<div
		class="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
		on:click={closeMobileMenu}
		on:keydown={(e) => e.key === 'Escape' && closeMobileMenu()}
		role="button"
		tabindex="0"
	></div>
{/if}

<!-- Sidebar -->
<div class="
	w-full lg:w-64 xl:w-72 flex-shrink-0 
	lg:border-r border-gray-200 dark:border-gray-700 
	bg-white dark:bg-gray-900 
	flex flex-col shadow-2xl
	lg:relative lg:translate-x-0
	fixed inset-y-0 left-0 z-40
	transform transition-transform duration-300 ease-in-out
	{isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
">
	<!-- Header -->
	<div class="p-3 md:p-4 pt-14 lg:pt-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
		
		<!-- Logo/Title - No close button here, removed justify-between -->
		<div class="mb-4">
			<button
				on:click={() => {
					goto('/');
					closeMobileMenu();
				}}
				class="flex items-center space-x-2.5 group cursor-pointer transition-transform hover:scale-105"
			>
				<div class="relative">
					<div class="absolute inset-0 bg-blue-500/20 dark:bg-blue-600/20 rounded-lg blur group-hover:blur-md transition-all"></div>
					<img src="/images/eda.svg" width="32" height="32" alt="Nokia EDA" class="relative drop-shadow-lg" />
				</div>
				<div class="text-left">
					<h1 class="text-base md:text-lg font-bold font-nokia-headline bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
						Nokia EDA
					</h1>
					<p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Resource Browser</p>
				</div>
			</button>
		</div>
		
		<!-- Release Selector -->
		<div class="mb-4">
			<label for="release-select" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
				Select Release
			</label>
			<select
				id="release-select"
				on:change={handleReleaseChange}
				value={$selectedRelease.name}
				class="w-full px-3 py-2 text-sm border border-white/20 rounded-lg focus:ring-2 focus:ring-cyan-400 bg-black/30 text-white transition-colors"
			>
				{#each releasesConfig.releases as release}
					<option value={release.name}>
						{release.label}{release.default ? ' (Default)' : ''}
					</option>
				{/each}
			</select>
		</div>
		
		<!-- Resource Search -->
		<div class="relative">
			<input
				type="text"
				bind:value={$resourceSearch}
				placeholder="Search resources..."
				class="w-full px-3 py-2 pl-9 text-sm border border-white/20 rounded-lg focus:ring-2 focus:ring-cyan-400 bg-black/30 text-white placeholder-gray-400 transition-colors"
			/>
			<svg
				class="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
		</div>
	</div>

	<!-- Resource List -->
	<div class="flex-1 overflow-y-auto p-3 md:p-4 space-y-1">
		<div class="mb-3 text-xs font-medium text-gray-500 dark:text-gray-400">
			{$resourceSearchFilter.length} resource{$resourceSearchFilter.length !== 1 ? 's' : ''} available
		</div>
		{#each $resourceSearchFilter as resDef}
			{@const isSelected = $page.url.pathname.startsWith(`/${resDef.name}/`)}
			<button
				on:click={() => handleResourceClick(resDef.name, resDef)}
				class="w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 group
				       {isSelected 
					? 'bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg' 
					: 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="flex-1 min-w-0">
						<div class="text-sm font-semibold truncate transition-colors
						            {isSelected 
							? 'text-white' 
							: 'text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400'}">
							{resDef.name.split('.')[0]}
						</div>
						<div class="text-xs truncate
						            {isSelected 
							? 'text-blue-100' 
							: 'text-gray-500 dark:text-gray-400'}">
							{resDef.name.split('.').slice(1).join('.')}
						</div>
						{#if resDef.versions.length > 1}
							<div class="flex items-center gap-1.5 mt-1">
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
								             {isSelected 
									? 'bg-white/20 text-white' 
									: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}">
									{resDef.versions.length} versions
								</span>
							</div>
						{/if}
					</div>
					<svg
						class="h-4 w-4 flex-shrink-0 mt-0.5 transition-colors
						       {isSelected 
							? 'text-white' 
							: 'text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'}"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
					</svg>
				</div>
			</button>
		{/each}
	</div>
</div>