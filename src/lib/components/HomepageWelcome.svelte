<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Theme from '$lib/components/Theme.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { getLatestVersion } from '$lib/versions';
	import type { Writable } from 'svelte/store';

	type ReleaseGroup = {
		label: string;
		releases: EdaRelease[];
		showMore: boolean;
	};

	export let groupedReleases: ReleaseGroup[];
	export let selectedRelease: Writable<EdaRelease>;
	export let crdMetaStore: Writable<CrdResource[]>;
	export let totalReleases: number;
	export let onReleaseSelect: (release: EdaRelease) => void | Promise<void>;
	export let onResourceSelect: (resourceName: string) => void | Promise<void>;
	export let onBrowseRelease: (release: EdaRelease) => void | Promise<void>;

	let heroSearch = '';
	let searchFocused = false;
	let highlightedIndex = 0;
	let resourceTypeFilter: 'all' | 'state' | 'config' = 'all';
	let displayResourceCount = 0;
	let displayReleaseCount = totalReleases;
	let prevResourceCount = -1;

	const tools = [
		{
			href: '/comparison',
			title: 'Release Comparison',
			description: 'Compare CRD schemas across EDA releases and generate diff reports.',
			accent: 'text-violet-600 dark:text-violet-400',
			iconBg: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			href: '/spec-search',
			title: 'Spec Search',
			description: 'Search CRD paths, fields, and nested properties across all releases.',
			accent: 'text-blue-600 dark:text-blue-400',
			iconBg: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			href: '/validate-yaml',
			title: 'YAML Validation',
			description: 'Validate configuration manifests against official EDA OpenAPI schemas.',
			accent: 'text-emerald-600 dark:text-emerald-400',
			iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
			icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
		}
	];

	$: filteredResources = $crdMetaStore
		.filter((resource) => {
			const query = heroSearch.trim().toLowerCase();
			if (!query) return false;
			const terms = query.split(/\s+/);
			const haystack = `${resource.name} ${resource.kind} ${resource.group}`.toLowerCase();
			if (!terms.every((term) => haystack.includes(term))) return false;
			if (resourceTypeFilter === 'state') return resource.name.toLowerCase().includes('states');
			if (resourceTypeFilter === 'config') return !resource.name.toLowerCase().includes('states');
			return true;
		})
		.slice(0, 8);

	$: multiVersionCount = $crdMetaStore.filter((r) => r.versions.length > 1).length;
	$: showSearchResults = searchFocused && heroSearch.trim().length > 0;

	$: if (filteredResources.length === 0) {
		highlightedIndex = 0;
	} else if (highlightedIndex >= filteredResources.length) {
		highlightedIndex = filteredResources.length - 1;
	}

	function animateCount(target: number, setter: (n: number) => void, duration = 700) {
		if (!browser) {
			setter(target);
			return;
		}
		const start = performance.now();
		const tick = (now: number) => {
			const progress = Math.min((now - start) / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			setter(Math.round(target * eased));
			if (progress < 1) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	$: {
		const count = $crdMetaStore.length;
		if (count !== prevResourceCount) {
			prevResourceCount = count;
			animateCount(count, (n) => (displayResourceCount = n));
		}
	}
	$: animateCount(totalReleases, (n) => (displayReleaseCount = n));

	function shortName(name: string) {
		return name.split('.')[0];
	}

	function groupName(name: string) {
		return name.split('.').slice(1).join('.');
	}

	function isDeprecated(resource: CrdResource) {
		return resource.versions.length > 0 && resource.versions.every((v) => v.deprecated);
	}

	async function pickResource(resource: CrdResource) {
		heroSearch = '';
		searchFocused = false;
		await onResourceSelect(resource.name);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (!showSearchResults || filteredResources.length === 0) {
			if (event.key === 'Enter' && filteredResources[0]) {
				event.preventDefault();
				void pickResource(filteredResources[0]);
			}
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlightedIndex = (highlightedIndex + 1) % filteredResources.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlightedIndex =
				(highlightedIndex - 1 + filteredResources.length) % filteredResources.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			void pickResource(filteredResources[highlightedIndex]);
		} else if (event.key === 'Escape') {
			searchFocused = false;
			heroSearch = '';
		}
	}

	function toggleGroupShow(label: string) {
		groupedReleases = groupedReleases.map((g) =>
			g.label === label ? { ...g, showMore: !g.showMore } : g
		);
	}

	async function handleReleaseClick(release: EdaRelease) {
		await onBrowseRelease(release);
	}

	function closeSearchResults() {
		if (browser) {
			setTimeout(() => (searchFocused = false), 150);
		}
	}
</script>

<div class="homepage-welcome min-h-full">
	<!-- Top bar -->
	<header class="homepage-topbar">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
			<div class="flex items-center gap-3">
				<img
					src="/images/eda.svg"
					alt="Nokia EDA"
					class="h-9 w-9"
					loading="eager"
					fetchpriority="high"
				/>
				<div class="leading-tight">
					<p class="text-sm font-semibold text-slate-900 dark:text-white">Nokia EDA</p>
					<p class="text-xs text-amber-600 dark:text-amber-400">Resource Browser</p>
				</div>
			</div>
			<Theme />
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
		<!-- 1. Compact hero -->
		<section class="homepage-hero mb-8 pt-2 text-center sm:pt-4">
			<span class="homepage-release-badge">
				{$selectedRelease.label}{#if $selectedRelease.default}
					<span class="homepage-default-tag">Default</span>{/if}
			</span>
			<h1 class="homepage-title mt-4">Browse EDA Custom Resource Definitions</h1>
			<p class="homepage-subtitle mx-auto mt-2 max-w-2xl">
				Explore schemas, compare versions across releases, and validate YAML — all in one place.
			</p>
		</section>

		<!-- 2. Search (primary CTA) -->
		<section class="homepage-card mb-6 p-5 sm:p-6" aria-labelledby="search-heading">
			<div class="mb-4">
				<h2 id="search-heading" class="homepage-section-title">Search resources</h2>
				<p class="homepage-section-desc mt-1">
					Find a CRD by name, kind, or API group. Results open the latest API version.
				</p>
			</div>

			<div class="relative">
				<label for="homepage-search" class="sr-only">Search CRD resources</label>
				<div class="homepage-search-input flex items-center gap-3">
					<svg
						class="h-5 w-5 shrink-0 text-slate-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
					<input
						id="homepage-search"
						type="search"
						bind:value={heroSearch}
						on:focus={() => (searchFocused = true)}
						on:blur={closeSearchResults}
						on:keydown={handleSearchKeydown}
						placeholder="e.g. AggregateRoute, protocols.eda.nokia.com…"
						class="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white dark:placeholder:text-slate-500"
						autocomplete="off"
						aria-expanded={showSearchResults}
						aria-controls="homepage-search-results"
					/>
					<kbd
						class="homepage-kbd hidden sm:inline"
						aria-hidden="true">↵</kbd
					>
				</div>

				{#if showSearchResults}
					<ul
						id="homepage-search-results"
						role="listbox"
						class="homepage-results absolute z-40 mt-1.5 w-full"
					>
						{#if filteredResources.length === 0}
							<li class="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">
								No resources match “{heroSearch}”
							</li>
						{:else}
							{#each filteredResources as resource, i}
								<li role="option" aria-selected={i === highlightedIndex}>
									<button
										type="button"
										on:mousedown|preventDefault={() => pickResource(resource)}
										class="homepage-result-row {i === highlightedIndex ? 'is-active' : ''}"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="truncate text-sm font-medium text-slate-900 dark:text-white">
													{resource.kind || shortName(resource.name)}
												</span>
												{#if isDeprecated(resource)}
													<span class="homepage-tag-warning">Deprecated</span>
												{/if}
											</div>
											<p class="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
												{groupName(resource.name)}
											</p>
										</div>
										{#if resource.versions.length > 0}
											<span class="homepage-tag-version">{getLatestVersion(resource)}</span>
										{/if}
									</button>
								</li>
							{/each}
						{/if}
					</ul>
				{/if}
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Resource type filter">
				<span class="text-xs font-medium text-slate-500 dark:text-slate-400">Type:</span>
				{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
					<button
						type="button"
						on:click={() => (resourceTypeFilter = chip.id as typeof resourceTypeFilter)}
						class="homepage-filter-chip {resourceTypeFilter === chip.id ? 'is-active' : ''}"
					>
						{chip.label}
					</button>
				{/each}
			</div>
		</section>

		<!-- 3. Stats strip -->
		<section class="homepage-stats mb-8" aria-label="Catalog statistics">
			{#each [
				{ value: displayReleaseCount, label: 'Releases', sub: 'EDA versions' },
				{ value: displayResourceCount, label: 'CRDs', sub: `in ${$selectedRelease.name}` },
				{ value: multiVersionCount, label: 'Multi-version', sub: 'resources with upgrades' }
			] as stat}
				<div class="homepage-stat">
					<p class="homepage-stat-value">{stat.value}</p>
					<p class="homepage-stat-label">{stat.label}</p>
					<p class="homepage-stat-sub">{stat.sub}</p>
				</div>
			{/each}
		</section>

		<!-- 4. Releases -->
		<section class="homepage-card mb-6 p-5 sm:p-6" aria-labelledby="releases-heading">
			<h2 id="releases-heading" class="homepage-section-title">EDA releases</h2>
			<p class="homepage-section-desc mt-1 mb-4">
				Choose a release, then browse its full CRD catalog.
			</p>

			<button
				type="button"
				on:click={() => onBrowseRelease($selectedRelease)}
				class="homepage-browse-cta mb-5 w-full sm:w-auto"
			>
				Browse {$selectedRelease.name} resources
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
				</svg>
			</button>

			<div class="space-y-5">
				{#each groupedReleases as group}
					<div>
						<p class="homepage-group-label">{group.label}</p>
						<div class="mt-2 flex flex-wrap gap-2">
							{#each group.releases.slice(0, 4) as release}
								<button
									type="button"
									on:click={() => handleReleaseClick(release)}
									class="homepage-release-btn {$selectedRelease.name === release.name
										? 'is-active'
										: ''}"
								>
									{release.name}
									{#if release.default}
										<span class="homepage-default-tag">Default</span>
									{/if}
								</button>
							{/each}
							{#if group.releases.length > 4}
								<div class="relative">
									<button
										type="button"
										on:click={() => toggleGroupShow(group.label)}
										class="homepage-release-btn homepage-release-more"
									>
										+{group.releases.length - 4} more
									</button>
									{#if group.showMore}
										<div class="homepage-dropdown">
											{#each group.releases.slice(4) as release}
												<button
													type="button"
													on:click={() => {
														handleReleaseClick(release);
														toggleGroupShow(group.label);
													}}
													class="homepage-dropdown-item"
												>
													{release.name}
												</button>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- 5. Tools -->
		<section aria-labelledby="tools-heading">
			<h2 id="tools-heading" class="homepage-section-title mb-1">Developer tools</h2>
			<p class="homepage-section-desc mb-5">Additional utilities for working with EDA schemas.</p>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				{#each tools as tool}
					<button type="button" on:click={() => goto(tool.href)} class="homepage-tool-card group">
						<div class="flex items-start gap-4">
							<div class="homepage-tool-icon {tool.iconBg}">
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={tool.icon}
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1 text-left">
								<h3 class="text-sm font-semibold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
									{tool.title}
								</h3>
								<p class="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
									{tool.description}
								</p>
								<span class="homepage-tool-link {tool.accent}">Open →</span>
							</div>
						</div>
					</button>
				{/each}
			</div>
		</section>
	</main>
</div>
