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

	const tools = [
		{
			href: '/comparison',
			title: 'Release Comparison',
			description: 'Compare CRD schemas across EDA releases and generate diff reports.',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			href: '/spec-search',
			title: 'Spec Search',
			description: 'Search CRD paths, fields, and nested properties across all releases.',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			href: '/validate-yaml',
			title: 'YAML Validation',
			description: 'Validate configuration manifests against official EDA OpenAPI schemas.',
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
		await onReleaseSelect(release);
	}

	function closeSearchResults() {
		if (browser) {
			setTimeout(() => (searchFocused = false), 150);
		}
	}
</script>

<div class="homepage-welcome min-h-full">
	<header class="homepage-topbar">
		<div class="homepage-topbar-inner">
			<div class="homepage-brand">
				<img
					src="/images/eda.svg"
					alt=""
					class="homepage-logo"
					loading="eager"
					fetchpriority="high"
				/>
				<span class="homepage-brand-title">Nokia EDA Resource Browser</span>
			</div>
			<Theme />
		</div>
	</header>

	<main class="homepage-main">
		<section class="homepage-hero" aria-labelledby="hero-heading">
			<h1 id="hero-heading" class="homepage-title">
				Browse EDA Custom Resource Definitions
			</h1>
			<p class="homepage-subtitle">
				Explore schemas, compare versions across releases, and validate YAML — all in one place.
			</p>
		</section>

		<section class="homepage-search-zone" aria-labelledby="search-heading">
			<p id="search-heading" class="homepage-section-label">Search</p>

			<div class="relative">
				<label for="homepage-search" class="sr-only">Search CRD resources</label>
				<div class="homepage-search-input">
					<svg
						class="homepage-search-icon"
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
						placeholder="Search by name, kind, or API group…"
						class="homepage-search-field"
						autocomplete="off"
						aria-expanded={showSearchResults}
						aria-controls="homepage-search-results"
					/>
					<kbd class="homepage-kbd hidden sm:inline" aria-hidden="true">↵</kbd>
				</div>

				{#if showSearchResults}
					<ul
						id="homepage-search-results"
						role="listbox"
						class="homepage-results"
					>
						{#if filteredResources.length === 0}
							<li class="homepage-results-empty">
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
												<span class="homepage-result-name">
													{resource.kind || shortName(resource.name)}
												</span>
												{#if isDeprecated(resource)}
													<span class="homepage-tag-warning">Deprecated</span>
												{/if}
											</div>
											<p class="homepage-result-group">
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

			<div class="homepage-filters" role="group" aria-label="Resource type filter">
				<span class="homepage-filters-label">Type</span>
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

		<section class="homepage-stats" aria-label="Catalog statistics">
			<div class="homepage-stat">
				<span class="homepage-stat-value">{totalReleases}</span>
				<span class="homepage-stat-label">Releases</span>
			</div>
			<div class="homepage-stat-divider" aria-hidden="true"></div>
			<div class="homepage-stat">
				<span class="homepage-stat-value">{$crdMetaStore.length}</span>
				<span class="homepage-stat-label">CRDs in {$selectedRelease.name}</span>
			</div>
			<div class="homepage-stat-divider" aria-hidden="true"></div>
			<div class="homepage-stat">
				<span class="homepage-stat-value">{multiVersionCount}</span>
				<span class="homepage-stat-label">Multi-version resources</span>
			</div>
		</section>

		<section class="homepage-section" aria-labelledby="releases-heading">
			<p id="releases-heading" class="homepage-section-label">Releases</p>
			<p class="homepage-section-desc">
				Select an EDA release, then browse its full CRD catalog.
			</p>

			<div class="homepage-releases">
				{#each groupedReleases as group}
					<div class="homepage-release-group">
						<p class="homepage-group-label">{group.label}</p>
						<div class="homepage-release-grid">
							{#each group.releases.slice(0, 4) as release}
								<button
									type="button"
									on:click={() => handleReleaseClick(release)}
									class="homepage-release-btn {$selectedRelease.name === release.name
										? 'is-active'
										: ''}"
									aria-pressed={$selectedRelease.name === release.name}
								>
									<span class="homepage-release-name">{release.name}</span>
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
										aria-expanded={group.showMore}
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
													class="homepage-dropdown-item {$selectedRelease.name === release.name
														? 'is-active'
														: ''}"
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

			<div class="homepage-browse-zone">
				<button
					type="button"
					on:click={() => onBrowseRelease($selectedRelease)}
					class="homepage-browse-cta"
				>
					Browse {$selectedRelease.name} resources
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M17 8l4 4m0 0l-4 4m4-4H3"
						/>
					</svg>
				</button>
			</div>
		</section>

		<section class="homepage-section" aria-labelledby="tools-heading">
			<p id="tools-heading" class="homepage-section-label">Developer tools</p>
			<p class="homepage-section-desc">Additional utilities for working with EDA schemas.</p>

			<div class="homepage-tools-grid">
				{#each tools as tool}
					<button type="button" on:click={() => goto(tool.href)} class="homepage-tool-card">
						<div class="homepage-tool-icon">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d={tool.icon}
								/>
							</svg>
						</div>
						<h3 class="homepage-tool-title">{tool.title}</h3>
						<p class="homepage-tool-desc">{tool.description}</p>
					</button>
				{/each}
			</div>
		</section>
	</main>
</div>
