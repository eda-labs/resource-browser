<script lang="ts">
	import { writable, derived } from 'svelte/store';
	import { sidebarOpen } from '$lib/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import yaml from 'js-yaml';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';
	import { onMount, onDestroy } from 'svelte';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
	const defaultRelease =
		releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];

	export const selectedRelease = writable<EdaRelease>(defaultRelease);
	export const crdMetaStore = writable<CrdResource[]>([]);
	const resourceSearch = writable('');

	// Filter for resource type: 'all' | 'state' | 'config'
	export const resourceTypeFilter = writable<'all' | 'state' | 'config'>('all');

	// Mobile menu state
	let isMobileMenuOpen = false;
	// Desktop sidebar state (from store) — auto-subscribed via `$sidebarOpen`
	let resourceListEl: HTMLElement | null = null;
	let sidebarThumbEl: HTMLElement | null = null;
	let hideThumbTimer: number | null = null;
	let thumbRaf: number | null = null;

	// Load CRDs dynamically for the selected release
	async function loadCrdsForRelease(release: EdaRelease) {
		try {
			const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
			if (manifestResponse.ok) {
				const manifest = await manifestResponse.json();
				crdMetaStore.set(manifest);
				// ensure the scroll thumb updates once the DOM is updated with new content
				setTimeout(() => updateThumb(), 0);
				return manifest as CrdResource[];
			}
		} catch (e) {
			// No manifest file found, loading from resources.yaml (fallback)
		}

		try {
			const res = await import('$lib/resources.yaml?raw');
			const resources = yaml.load(res.default) as any;
			const crdMeta = Object.values(resources).flat() as CrdResource[];
			crdMetaStore.set(crdMeta);
			setTimeout(() => updateThumb(), 0);
			return crdMeta;
		} catch (e) {
			console.error('Failed to load resources:', e);
			crdMetaStore.set([]);
			return [] as CrdResource[];
		}
	}

	$: loadCrdsForRelease($selectedRelease);

	const resourceSearchFilter = derived(
		[resourceSearch, crdMetaStore, resourceTypeFilter],
		([$resourceSearch, $crdMetaStore, $resourceTypeFilter]) => {
			const query = $resourceSearch.toLowerCase();
			let filtered = $crdMetaStore.filter((x) =>
				query.split(/\s+/).every((term) => x.name.toLowerCase().includes(term))
			);

			if ($resourceTypeFilter === 'state') {
				filtered = filtered.filter((x) => x.name.toLowerCase().includes('states'));
			} else if ($resourceTypeFilter === 'config') {
				filtered = filtered.filter((x) => !x.name.toLowerCase().includes('states'));
			}

			return filtered;
		}
	);

	onMount(() => {
		// Check if a specific release is requested
		const urlParams = new URLSearchParams(window.location.search);
		const releaseParam = urlParams.get('release');
		if (releaseParam) {
			const foundRelease = releasesConfig.releases.find((r) => r.name === releaseParam);
			if (foundRelease) {
				selectedRelease.set(foundRelease);
			}
		}
	});

	async function handleReleaseChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const newReleaseName = select.value;
		const newRelease = releasesConfig.releases.find((r) => r.name === newReleaseName);
		if (newRelease) {
			selectedRelease.set(newRelease);

			// Check if we're on a detail page
			const currentPath = window.location.pathname;
			const isDetailPage = currentPath !== '/' && currentPath.includes('/');

			if (isDetailPage) {
				// Extract current resource name and version from URL
				const pathParts = currentPath.split('/').filter((p) => p);
				if (pathParts.length >= 1) {
					const currentResourceName = pathParts[0];
					const currentVersion = pathParts.length >= 2 ? pathParts[1] : '';

					// Load the manifest for the new release and search for the resource
					const manifest = await loadCrdsForRelease(newRelease);
					const resourceInNewRelease = (manifest || []).find((r) => r.name === currentResourceName);
					if (resourceInNewRelease) {
						// If the same version exists in the new release, choose it; otherwise fall back to the first available version
						let targetVersion = resourceInNewRelease.versions?.find(
							(v) => v.name === currentVersion
						)?.name;
						if (!targetVersion) {
							// Pick a reasonable default: prefer the last version in array if sorted or the first entry
							targetVersion =
								resourceInNewRelease.versions && resourceInNewRelease.versions.length
									? resourceInNewRelease.versions[0].name
									: '';
						}
						if (targetVersion) {
							goto(`/${currentResourceName}/${targetVersion}?release=${newRelease.name}`);
						} else {
							// No version found; redirect to browse mode for the new release
							goto(`/?browse=true&release=${newRelease.name}`);
						}
					} else {
						// Resource doesn't exist in new release, go to browse mode
						goto(`/?browse=true&release=${newRelease.name}`);
					}
					return;
				}
			}

			// Default: redirect to homepage in browse mode
			goto(`/?browse=true&release=${newRelease.name}`);
		}
	}

	async function handleResourceClick(resource: string, resDef: CrdResource) {
		// Ensure we select a version that exists in the currently selected release
		try {
			const manifest = await loadCrdsForRelease($selectedRelease);
			const resourceInRelease = (manifest || []).find((r) => r.name === resource);
			let targetVersion = '';
			// Prefer the same version that the resources.yaml object suggests if available in the release manifest
			if (resourceInRelease && resourceInRelease.versions && resourceInRelease.versions.length) {
				const pref = resDef?.versions?.[0]?.name;
				targetVersion =
					resourceInRelease.versions.find((v) => v.name === pref)?.name ||
					resourceInRelease.versions[0].name;
			} else {
				// Fallback to the resources.yaml version if the manifest doesn't include it
				targetVersion = resDef?.versions?.[0]?.name || '';
			}
			if (targetVersion) {
				goto(`/${resource}/${targetVersion}?release=${$selectedRelease.name}`);
			} else {
				goto(`/?browse=true&release=${$selectedRelease.name}`);
			}
		} catch (e) {
			// In case of any error, fallback to the original behavior to avoid blocking navigation
			goto(`/${resource}/${resDef.versions[0].name}?release=${$selectedRelease.name}`);
		}
		// Close mobile menu after navigation
		isMobileMenuOpen = false;
	}

	/**
	 * Determine the preferred version used for navigation for a resource in the current release.
	 * This uses the release manifest if available, and prefers the version hinted by `resDef.versions[0]`.
	 */
	function preferredVersionForResource(resDef: CrdResource) {
		const manifestEntry = $crdMetaStore.find((r) => r.name === resDef.name) || resDef;
		const pref = resDef?.versions?.[0]?.name;
		if (manifestEntry && manifestEntry.versions && manifestEntry.versions.length) {
			const found = manifestEntry.versions.find((v) => v.name === pref);
			return found ? found.name : manifestEntry.versions[0].name;
		}
		return pref || '';
	}

	function isPreferredVersionDeprecated(resDef: CrdResource) {
		const manifestEntry = $crdMetaStore.find((r) => r.name === resDef.name) || resDef;
		const pv = preferredVersionForResource(resDef);
		if (!pv || !manifestEntry.versions) return false;
		const vobj = manifestEntry.versions.find((v) => v.name === pv);
		return !!(vobj && vobj.deprecated);
	}

	function toggleMobileMenu() {
		isMobileMenuOpen = !isMobileMenuOpen;
	}

	function closeMobileMenu() {
		isMobileMenuOpen = false;
	}

	function handleListScroll() {
		// Throttle scroll update via requestAnimationFrame to avoid forced re-layouts on heavy scroll events
		if (thumbRaf) return;
		thumbRaf = requestAnimationFrame(() => {
			updateThumb();
			thumbRaf = null;
		});
	}

	function updateThumb() {
		if (!resourceListEl || !sidebarThumbEl) return;
		const { scrollTop, scrollHeight, clientHeight } = resourceListEl;
		if (scrollHeight <= clientHeight) {
			// no scroll needed
			sidebarThumbEl.style.opacity = '0';
			return;
		}
		const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 20);
		const maxTop = clientHeight - thumbHeight;
		const top = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
		sidebarThumbEl.style.height = `${thumbHeight}px`;
		sidebarThumbEl.style.transform = `translateY(${top}px)`;
		sidebarThumbEl.style.opacity = '1';
		// reset hide timer so the thumb fades out after a brief idle
		if (hideThumbTimer) window.clearTimeout(hideThumbTimer);
		hideThumbTimer = window.setTimeout(() => {
			if (sidebarThumbEl) sidebarThumbEl.style.opacity = '0';
		}, 1200);
	}

	onMount(() => {
		// initial calculation and listen for resizes to adjust thumb
		updateThumb();
		const resizeObserver = new ResizeObserver(() => updateThumb());
		if (resourceListEl) resizeObserver.observe(resourceListEl);
		window.addEventListener('resize', updateThumb);
		onDestroy(() => {
			if (resourceListEl) resizeObserver.unobserve(resourceListEl);
			window.removeEventListener('resize', updateThumb);
		});
	});
</script>

<!-- Hamburger Button (Mobile Only) -->
<button
	on:click={toggleMobileMenu}
	class="fixed top-2 left-2 z-[60] rounded-lg border border-gray-200 bg-white p-2 shadow-lg transition-all hover:bg-gray-50 lg:hidden dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
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

<!-- (removed mini logo) -->

<!-- Overlay (Mobile Only) -->
{#if isMobileMenuOpen}
	<div
		class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
		on:click={closeMobileMenu}
		on:keydown={(e) => e.key === 'Escape' && closeMobileMenu()}
		role="button"
		tabindex="0"
	></div>
{/if}

<!-- Sidebar -->
<div
	class="fixed inset-y-0 left-0 z-[50] flex w-72 flex-col border-r border-gray-200 bg-white shadow-xl transition-transform duration-300 ease-in-out
	       lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-64 xl:w-72
	       dark:border-gray-700 dark:bg-gray-900
	       {isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
	       {$sidebarOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'}"
>
	<!-- Header -->
	<div class="relative border-b border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
		<!-- Desktop toggle -->
		<button
			class="absolute top-2 right-2 hidden items-center justify-center rounded-md border border-gray-200 bg-white p-1.5 shadow-sm transition-all hover:bg-gray-50 lg:inline-flex dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
			on:click={() => sidebarOpen.toggle()}
			aria-label={$sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
		>
			<svg class="h-4 w-4 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				{#if $sidebarOpen}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				{/if}
			</svg>
		</button>

		<!-- Release Selector -->
		<div class="mb-3">
			<label for="release-select" class="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
				Release
			</label>
			<select
				id="release-select"
				on:change={handleReleaseChange}
				value={$selectedRelease.name}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:border-gray-500"
			>
				{#each releasesConfig.releases as release}
					<option value={release.name}>{release.label}{release.default ? ' (Default)' : ''}</option>
				{/each}
			</select>
		</div>

		<!-- Resource Search -->
		<div class="space-y-2">
			<div class="relative">
				<input
					type="text"
					bind:value={$resourceSearch}
					placeholder="Search resources..."
					class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pl-9 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-500"
				/>
				<svg class="absolute top-2.5 left-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</div>

			<!-- Resource Type Filter -->
			<select
				id="resource-type-filter"
				bind:value={$resourceTypeFilter}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:border-gray-500"
				aria-label="Filter resources"
			>
				<option value="all">All Resources</option>
				<option value="state">State Resources</option>
				<option value="config">Config Resources</option>
			</select>
		</div>
	</div>

	<!-- Resource List -->
	<div
		class="relative flex-1 overflow-y-auto p-3"
		bind:this={resourceListEl}
		on:scroll={handleListScroll}
	>
		<div class="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
			{$resourceSearchFilter.length} resource{$resourceSearchFilter.length !== 1 ? 's' : ''}
		</div>
		<div class="space-y-1">
			<!-- Custom scroll thumb -->
			<div aria-hidden="true" class="sidebar-scroll-thumb" bind:this={sidebarThumbEl}></div>
		{#each $resourceSearchFilter as resDef}
			{@const isSelected = $page.url.pathname.startsWith(`/${resDef.name}/`)}
			<button
				on:click={() => handleResourceClick(resDef.name, resDef)}
				class="group w-full rounded-lg px-2.5 py-2 text-left transition-all
				       {isSelected
					? 'bg-gradient-to-r from-cyan-500 to-blue-600 shadow-md'
					: 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<div
								class="truncate text-sm font-semibold
												{isSelected
									? 'text-white'
									: 'text-gray-900 group-hover:text-cyan-600 dark:text-white dark:group-hover:text-cyan-400'}"
							>
								{resDef.name.split('.')[0]}
							</div>
							{#if isPreferredVersionDeprecated(resDef)}
								<span
									class="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
									>DEPRECATED</span
								>
							{/if}
						</div>
						<div
							class="truncate text-xs
							{isSelected ? 'text-cyan-100' : 'text-gray-500 dark:text-gray-400'}"
						>
							{resDef.name.split('.').slice(1).join('.')}
						</div>
						{#if resDef.versions.length > 1}
							<div class="mt-0.5">
								<span
									class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium
								             {isSelected
										? 'bg-white/20 text-white'
										: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'}"
								>
									{resDef.versions.length} versions
								</span>
							</div>
						{/if}
					</div>
					<svg
						class="mt-0.5 h-4 w-4 flex-shrink-0
						       {isSelected
							? 'text-white'
							: 'text-gray-400 group-hover:text-cyan-600 dark:group-hover:text-cyan-400'}"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						/>
					</svg>
				</div>
			</button>
		{/each}
		</div>
	</div>
</div>
