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
			description: 'Diff CRD schemas across EDA releases.',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			href: '/spec-search',
			title: 'Spec Search',
			description: 'Query paths and fields across all CRDs.',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			href: '/validate-yaml',
			title: 'YAML Validation',
			description: 'Validate manifests against OpenAPI schemas.',
			icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
		}
	];

	const quickActions = [
		{
			id: 'browse',
			label: 'Browse catalog',
			description: 'Open full CRD list for selected release',
			primary: true,
			icon: 'M4 6h16M4 10h16M4 14h16M4 18h16'
		},
		{
			id: 'compare',
			label: 'Compare releases',
			description: 'Schema diff across versions',
			href: '/comparison',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			id: 'validate',
			label: 'Validate YAML',
			description: 'Check manifest against schema',
			href: '/validate-yaml',
			icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
		},
		{
			id: 'spec',
			label: 'Spec search',
			description: 'Find fields and properties',
			href: '/spec-search',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		}
	];

	$: apiGroupCount = new Set($crdMetaStore.map((r) => r.group || r.name.split('.').slice(1).join('.'))).size;

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

	$: previewResources = $crdMetaStore.slice(0, 6);
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

	async function handleReleaseClick(release: EdaRelease) {
		await onReleaseSelect(release);
	}

	function handleQuickAction(action: (typeof quickActions)[number]) {
		if (action.id === 'browse') {
			void onBrowseRelease($selectedRelease);
		} else if (action.href) {
			void goto(action.href);
		}
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
			<p class="homepage-hero-kicker">Nokia Event-Driven Automation</p>
			<h1 id="hero-heading" class="homepage-title">EDA CRD Schema Explorer</h1>
			<p class="homepage-subtitle">
				Search, browse, and validate Custom Resource Definitions across EDA releases — built for
				network operators and platform engineers.
			</p>
		</section>

		<section class="homepage-search-zone" aria-labelledby="search-heading">
			<label for="homepage-search" class="sr-only">Search CRD resources</label>
			<div class="relative">
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
						placeholder="Search {$crdMetaStore.length > 0 ? $crdMetaStore.length + '+' : '500+'} CRDs by name, kind, or group…"
						class="homepage-search-field"
						autocomplete="off"
						aria-expanded={showSearchResults}
						aria-controls="homepage-search-results"
					/>
					<kbd class="homepage-kbd hidden sm:inline" aria-hidden="true">↵</kbd>
				</div>

				{#if showSearchResults}
					<ul id="homepage-search-results" role="listbox" class="homepage-results">
						{#if filteredResources.length === 0}
							<li class="homepage-results-empty">No resources match “{heroSearch}”</li>
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
											<p class="homepage-result-group">{groupName(resource.name)}</p>
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
				<span class="homepage-filters-label">Filter</span>
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
				<span class="homepage-stat-label">CRDs · {$selectedRelease.name}</span>
			</div>
			<div class="homepage-stat-divider" aria-hidden="true"></div>
			<div class="homepage-stat">
				<span class="homepage-stat-value">{apiGroupCount}</span>
				<span class="homepage-stat-label">API groups</span>
			</div>
		</section>

		<div class="homepage-workspace">
			<section class="homepage-panel homepage-releases-panel" aria-labelledby="releases-heading">
				<div class="homepage-panel-header">
					<h2 id="releases-heading" class="homepage-panel-title">EDA Releases</h2>
					<p class="homepage-panel-desc">Select a release to load its CRD manifest</p>
				</div>

				<div class="homepage-release-table-wrap">
					<table class="homepage-release-table">
						<thead>
							<tr>
								<th scope="col">Version</th>
								<th scope="col">Label</th>
								<th scope="col" class="text-right">CRDs</th>
							</tr>
						</thead>
						<tbody>
							{#each groupedReleases as group}
								<tr class="homepage-release-group-row">
									<td colspan="3">{group.label}</td>
								</tr>
								{#each group.releases as release}
									<tr
										class="homepage-release-row {$selectedRelease.name === release.name
											? 'is-selected'
											: ''}"
									>
										<td>
											<button
												type="button"
												class="homepage-release-select"
												on:click={() => handleReleaseClick(release)}
												aria-pressed={$selectedRelease.name === release.name}
											>
												<span class="homepage-release-version">{release.name}</span>
												{#if release.default}
													<span class="homepage-default-tag">default</span>
												{/if}
											</button>
										</td>
										<td class="homepage-release-label">{release.label}</td>
										<td class="homepage-release-count text-right">
											{#if $selectedRelease.name === release.name}
												<span class="homepage-tag-version">{$crdMetaStore.length}</span>
											{:else}
												<span class="homepage-release-count-dash">—</span>
											{/if}
										</td>
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			<aside class="homepage-panel homepage-actions-panel" aria-labelledby="actions-heading">
				<div class="homepage-panel-header">
					<h2 id="actions-heading" class="homepage-panel-title">Quick actions</h2>
					<p class="homepage-panel-desc">
						Selected: <span class="homepage-mono">{$selectedRelease.name}</span>
					</p>
				</div>

				<div class="homepage-actions-list">
					{#each quickActions as action}
						<button
							type="button"
							class="homepage-action-btn {action.primary ? 'is-primary' : ''}"
							on:click={() => handleQuickAction(action)}
						>
							<span class="homepage-action-icon" aria-hidden="true">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={action.icon}
									/>
								</svg>
							</span>
							<span class="homepage-action-text">
								<span class="homepage-action-label">{action.label}</span>
								<span class="homepage-action-desc">{action.description}</span>
							</span>
							{#if action.primary}
								<svg
									class="homepage-action-arrow h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M17 8l4 4m0 0l-4 4m4-4H3"
									/>
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			</aside>
		</div>

		{#if previewResources.length > 0}
			<section class="homepage-resource-strip" aria-labelledby="preview-heading">
				<div class="homepage-strip-header">
					<h2 id="preview-heading" class="homepage-strip-title">
						Top resources · {$selectedRelease.name}
					</h2>
					<button
						type="button"
						class="homepage-strip-link"
						on:click={() => onBrowseRelease($selectedRelease)}
					>
						View all →
					</button>
				</div>
				<div class="homepage-resource-chips">
					{#each previewResources as resource}
						<button
							type="button"
							class="homepage-resource-chip"
							on:click={() => onResourceSelect(resource.name)}
							title="{resource.kind || shortName(resource.name)} · {groupName(resource.name)}"
						>
							<span class="homepage-chip-kind">{resource.kind || shortName(resource.name)}</span>
							<span class="homepage-chip-group">{groupName(resource.name)}</span>
							{#if resource.versions.length > 0}
								<span class="homepage-chip-version">{getLatestVersion(resource)}</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<section class="homepage-section" aria-labelledby="tools-heading">
			<h2 id="tools-heading" class="homepage-section-label">Operator tools</h2>
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
