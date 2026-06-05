<script lang="ts">
	import { writable, derived } from 'svelte/store';
	import { sidebarOpen, mobileSidebarOpen } from '$lib/store';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import yaml from 'js-yaml';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';
	import { getLatestVersion } from '$lib/versions';
	import { onMount, onDestroy } from 'svelte';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
	const defaultRelease =
		releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];

	function releaseFromParam(param: string | null): EdaRelease {
		if (param) {
			const found = releasesConfig.releases.find((r) => r.name === param);
			if (found) return found;
		}
		return defaultRelease;
	}

	export const selectedRelease = writable<EdaRelease>(defaultRelease);
	export const crdMetaStore = writable<CrdResource[]>([]);
	const resourceSearch = writable('');

	// Filter for resource type: 'all' | 'state' | 'config'
	export const resourceTypeFilter = writable<'all' | 'state' | 'config'>('all');

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

	// Close mobile drawer when navigating
	$: if ($page.url.pathname) {
		mobileSidebarOpen.set(false);
	}

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

	let lastSyncedReleaseParam: string | null | undefined = undefined;

	$: if (browser) {
		const param = $page.url.searchParams.get('release');
		if (param !== lastSyncedReleaseParam) {
			lastSyncedReleaseParam = param;
			const release = releaseFromParam(param);
			selectedRelease.set(release);
			void loadCrdsForRelease(release);
		}
	}

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
							targetVersion = getLatestVersion(resourceInNewRelease);
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
			const targetVersion =
				getLatestVersion(resourceInRelease) || getLatestVersion(resDef) || '';
			if (targetVersion) {
				goto(`/${resource}/${targetVersion}?release=${$selectedRelease.name}`);
			} else {
				goto(`/?browse=true&release=${$selectedRelease.name}`);
			}
		} catch (e) {
			const fallbackVersion = getLatestVersion(resDef);
			if (fallbackVersion) {
				goto(`/${resource}/${fallbackVersion}?release=${$selectedRelease.name}`);
			} else {
				goto(`/?browse=true&release=${$selectedRelease.name}`);
			}
		}
		mobileSidebarOpen.set(false);
	}

	function closeMobileDrawer() {
		mobileSidebarOpen.set(false);
	}

	function isPreferredVersionDeprecated(resDef: CrdResource) {
		const manifestEntry = $crdMetaStore.find((r) => r.name === resDef.name) || resDef;
		if (!manifestEntry.versions || manifestEntry.versions.length === 0) return false;
		// Only show DEPRECATED if every available version is deprecated (i.e. no newer version exists)
		return manifestEntry.versions.every((v) => v.deprecated);
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

<!-- Overlay (Mobile Only) -->
{#if $mobileSidebarOpen}
	<div
		class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
		on:click={closeMobileDrawer}
		on:keydown={(e) => e.key === 'Escape' && closeMobileDrawer()}
		role="button"
		tabindex="0"
		aria-label="Close navigation"
	></div>
{/if}

<!-- Sidebar -->
<div
	class="app-sidebar surface-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 ease-in-out
	       lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100dvh-4rem)] lg:w-64 xl:w-72
	       dark:border-blue-900/40
	       {$mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
	       {$sidebarOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'}"
>
	<!-- Header -->
	<div class="relative border-b border-slate-200 bg-slate-50 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-blue-900/30 dark:bg-[#0c2340]/60">
		<!-- Mobile close -->
		<button
			type="button"
			class="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 lg:hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
			on:click={closeMobileDrawer}
			aria-label="Close navigation"
		>
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>

		<!-- Desktop toggle -->
		<button
			type="button"
			class="absolute top-2 right-2 hidden min-h-9 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm transition-all hover:bg-slate-50 lg:inline-flex dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
			on:click={() => sidebarOpen.toggle()}
			aria-label={$sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
		>
			<svg class="h-4 w-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				{#if $sidebarOpen}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				{:else}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				{/if}
			</svg>
		</button>

		<!-- Release Selector -->
		<div class="mb-3">
			<label for="release-select" class="mb-1.5 block text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
				Release
			</label>
			<select
				id="release-select"
				on:change={handleReleaseChange}
				value={$selectedRelease.name}
				class="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
			>
				{#each releasesConfig.releases as release}
					<option value={release.name}>{release.label}{release.default ? ' (Latest)' : ''}</option>
				{/each}
			</select>
		</div>

		<!-- Resource Search -->
		<div class="space-y-2">
			<div class="relative">
				<input
					type="search"
					bind:value={$resourceSearch}
					placeholder="Search by kind, name, or API group…"
					class="min-h-11 w-full rounded-lg border border-slate-200 bg-white py-2.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
				/>
				<svg class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</div>

			<!-- Resource Type Filter -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Resource type filter">
				{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
					<button
						type="button"
						on:click={() => resourceTypeFilter.set(chip.id as 'all' | 'state' | 'config')}
						class="shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors
						       {$resourceTypeFilter === chip.id
							? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300'
							: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}"
					>
						{chip.label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Resource List -->
	<div
		class="relative flex-1 overflow-y-auto p-3"
		bind:this={resourceListEl}
		on:scroll={handleListScroll}
	>
		<div class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
			<span class="tabular-nums">{$resourceSearchFilter.length}</span>
			resource{$resourceSearchFilter.length !== 1 ? 's' : ''}
		</div>
		<div class="space-y-0.5">
			<!-- Custom scroll thumb -->
			<div aria-hidden="true" class="sidebar-scroll-thumb" bind:this={sidebarThumbEl}></div>
		{#each $resourceSearchFilter as resDef}
			{@const isSelected = $page.url.pathname.startsWith(`/${resDef.name}/`)}
			<button
				type="button"
				on:click={() => handleResourceClick(resDef.name, resDef)}
				class="group min-h-11 w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors
				       {isSelected
					? 'border-blue-200 bg-blue-50/80 dark:border-blue-800 dark:bg-blue-900/20'
					: 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'}"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<div
								class="truncate text-sm font-semibold
												{isSelected
									? 'text-blue-700 dark:text-blue-300'
									: 'text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400'}"
							>
								{resDef.name.split('.')[0]}
							</div>
							{#if isPreferredVersionDeprecated(resDef)}
								<span
									class="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
									>DEPRECATED</span
								>
							{/if}
						</div>
						<div
							class="truncate font-mono text-xs
							{isSelected ? 'text-blue-600/80 dark:text-blue-400/80' : 'text-slate-500 dark:text-slate-400'}"
						>
							{resDef.name.split('.').slice(1).join('.')}
						</div>
						{#if resDef.versions.length > 1}
							<div class="mt-0.5">
								<span
									class="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
								>
									{getLatestVersion(resDef)}
								</span>
							</div>
						{/if}
					</div>
					<svg
						class="mt-0.5 h-4 w-4 flex-shrink-0 transition-transform
						       {isSelected
							? 'text-blue-500'
							: 'text-slate-400 group-hover:translate-x-0.5 group-hover:text-blue-500'}"
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
