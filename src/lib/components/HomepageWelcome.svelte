<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { searchResources } from '$lib/resourceSearch';
	import { getLatestVersion } from '$lib/versions';
	import type { Writable } from 'svelte/store';

	type ReleaseGroup = {
		label: string;
		releases: EdaRelease[];
	};

	export let groupedReleases: ReleaseGroup[];
	export let selectedRelease: Writable<EdaRelease>;
	export let crdMetaStore: Writable<CrdResource[]>;
	export let onResourceSelect: (resourceName: string) => void | Promise<void>;
	export let onBrowseRelease: (release: EdaRelease) => void | Promise<void>;

	const VISIBLE_PER_TRAIN = 3;

	let heroSearch = '';
	let searchFocused = false;
	let highlightedIndex = 0;
	let resourceTypeFilter: 'all' | 'state' | 'config' = 'all';

	function visibleReleasesForGroup(releases: EdaRelease[]) {
		const top = releases.slice(0, VISIBLE_PER_TRAIN);
		const selected = $selectedRelease;
		if (top.some((release) => release.name === selected.name)) return top;
		const selectedInGroup = releases.find((release) => release.name === selected.name);
		if (!selectedInGroup) return top;
		return [
			selectedInGroup,
			...top.filter((release) => release.name !== selectedInGroup.name)
		].slice(0, VISIBLE_PER_TRAIN);
	}

	function hiddenReleasesForGroup(releases: EdaRelease[], visible: EdaRelease[]) {
		return releases.filter(
			(release) => !visible.some((item) => item.name === release.name)
		);
	}

	const quickActions = [
		{
			id: 'browse',
			label: 'Browse catalog',
			description: '',
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
		},
		{
			id: 'dep-map',
			label: 'Dependency map',
			description: 'CRD relationships from schemas',
			href: '/dependency-map',
			icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'
		}
	];

	$: filteredResources = searchResources(
		$crdMetaStore.filter((resource) => {
			if (resourceTypeFilter === 'state') return resource.name.toLowerCase().includes('states');
			if (resourceTypeFilter === 'config') return !resource.name.toLowerCase().includes('states');
			return true;
		}),
		heroSearch
	);

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
		await onBrowseRelease(release);
	}

	async function handleMoreReleasePick(groupLabel: string, event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const value = select.value;
		select.value = '';
		if (!value) return;
		const group = groupedReleases.find((item) => item.label === groupLabel);
		const release = group?.releases.find((item) => item.name === value);
		if (release) await handleReleaseClick(release);
	}

	function handleQuickAction(action: (typeof quickActions)[number]) {
		if (action.id === 'browse') {
			void onBrowseRelease($selectedRelease);
		} else if (action.href) {
			const url = `${action.href}?release=${encodeURIComponent($selectedRelease.name)}`;
			void goto(url);
		}
	}

	function closeSearchResults() {
		if (browser) {
			setTimeout(() => (searchFocused = false), 150);
		}
	}
</script>

<div
	class="homepage-welcome page-shell min-h-full bg-gray-50 text-gray-900 dark:text-gray-100"
>
	<AppHeader />

	<main class="homepage-main">
		<section class="homepage-hero" aria-labelledby="hero-heading">
			<p class="homepage-hero-kicker">Nokia Event-Driven Automation</p>
			<h1 id="hero-heading" class="homepage-title text-slate-900 dark:text-slate-100">
				EDA CRD Schema Explorer
			</h1>
		</section>

		<section class="homepage-search-zone" aria-labelledby="search-heading">
			<label for="homepage-search" class="sr-only">Search CRD resources</label>
			<div class="relative">
				<div
					class="homepage-search-input border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
				>
					<svg
						class="homepage-search-icon text-slate-400 dark:text-slate-500"
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
						class="homepage-search-field text-slate-900 placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
						autocomplete="off"
						aria-controls="homepage-search-results"
						aria-autocomplete="list"
					/>
					<kbd
						class="homepage-kbd hidden border-slate-200 bg-slate-100 text-slate-500 sm:inline dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400"
						aria-hidden="true">↵</kbd
					>
				</div>

				{#if showSearchResults}
					<ul
						id="homepage-search-results"
						role="listbox"
						class="homepage-results border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
					>
						{#if filteredResources.length === 0}
							<li class="homepage-results-empty text-slate-500 dark:text-slate-400">
								No resources match “{heroSearch}”
							</li>
						{:else}
							{#each filteredResources as resource, i}
								<li role="option" aria-selected={i === highlightedIndex}>
									<button
										type="button"
										on:mousedown|preventDefault={() => pickResource(resource)}
										class="homepage-result-row {i === highlightedIndex
											? 'is-active bg-slate-100 dark:bg-slate-700'
											: ''}"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span
													class="homepage-result-name text-slate-900 dark:text-slate-100"
												>
													{resource.kind || shortName(resource.name)}
												</span>
												{#if isDeprecated(resource)}
													<span class="homepage-tag-warning">Deprecated</span>
												{/if}
											</div>
											<p class="homepage-result-group text-slate-500 dark:text-slate-400">
												{groupName(resource.name)}
											</p>
										</div>
										{#if resource.versions.length > 0}
											<span
												class="homepage-tag-version bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
											>
												{getLatestVersion(resource)}
											</span>
										{/if}
									</button>
								</li>
							{/each}
						{/if}
					</ul>
				{/if}
			</div>

			<div class="homepage-filters" role="group" aria-label="Resource type filter">
				<span class="homepage-filters-label text-slate-500 dark:text-slate-400">Filter</span>
				{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
					<button
						type="button"
						on:click={() => (resourceTypeFilter = chip.id as typeof resourceTypeFilter)}
						class="homepage-filter-chip border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300 {resourceTypeFilter ===
						chip.id
							? 'is-active'
							: ''}"
					>
						{chip.label}
					</button>
				{/each}
			</div>
		</section>

		<div class="homepage-workspace">
			<section
				class="homepage-panel homepage-releases-panel homepage-releases-panel--prominent border-slate-200 bg-white dark:border-blue-900/40"
				aria-labelledby="releases-heading"
			>
				<div class="homepage-releases-hero">
					<h2
						id="releases-heading"
						class="homepage-releases-heading text-slate-900 dark:text-slate-100"
					>
						EDA Releases
					</h2>
					<div class="homepage-selected-release" aria-live="polite">
						<span class="homepage-selected-label text-slate-500 dark:text-slate-400"
							>Selected</span
						>
						<span class="homepage-selected-version text-slate-900 dark:text-white"
							>{$selectedRelease.name}</span
						>
						{#if $selectedRelease.default}
							<span class="homepage-default-tag homepage-default-tag--hero">latest</span>
						{/if}
					</div>
				</div>

				<div class="homepage-release-picker">
					<div class="homepage-releases" role="group" aria-label="EDA releases by train">
						{#each groupedReleases as group (group.label)}
							{@const visibleReleases = visibleReleasesForGroup(group.releases)}
							{@const hiddenReleases = hiddenReleasesForGroup(
								group.releases,
								visibleReleases
							)}
							<div class="homepage-train-row">
								<div class="homepage-train-label" aria-hidden="true">
									{group.label}
								</div>
								<div class="homepage-train-releases">
									<div
										class="homepage-train-release-cards"
										role="listbox"
										aria-label="{group.label} releases"
									>
										{#each visibleReleases as release (release.name)}
											{@const isSelected = $selectedRelease.name === release.name}
											<button
												type="button"
												role="option"
												class="homepage-release-btn {isSelected ? 'is-active' : ''}"
												aria-selected={isSelected}
												on:click={() => handleReleaseClick(release)}
											>
												<span class="homepage-release-name">{release.name}</span>
												{#if isSelected}
													<span
														class="homepage-release-active-dot"
														aria-hidden="true"
													></span>
												{/if}
												{#if release.default}
													<span
														class="homepage-default-tag {isSelected
															? 'homepage-default-tag--on-active'
															: 'homepage-default-tag--pill'}">latest</span
													>
												{/if}
											</button>
										{/each}
									</div>
									{#if hiddenReleases.length > 0}
										<div class="homepage-train-more">
											<label
												for="homepage-more-{group.label}"
												class="sr-only"
											>
												More {group.label} releases
											</label>
											<select
												id="homepage-more-{group.label}"
												class="homepage-train-more-select border-slate-200 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
												on:change={(event) =>
													handleMoreReleasePick(group.label, event)}
											>
												<option value="">More</option>
												{#each hiddenReleases as release (release.name)}
													<option value={release.name}>{release.name}</option>
												{/each}
											</select>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</section>

			<aside
				class="homepage-panel homepage-actions-panel border-slate-200 bg-white dark:border-blue-900/40"
				aria-labelledby="actions-heading"
			>
				<div
					class="homepage-panel-header border-b border-slate-200 dark:border-slate-700"
				>
					<h2
						id="actions-heading"
						class="homepage-panel-title text-slate-900 dark:text-slate-100"
					>
						Quick actions
					</h2>
					<p class="homepage-panel-desc text-slate-500 dark:text-slate-400">
						Selected: <span class="homepage-mono text-slate-900 dark:text-slate-200"
							>{$selectedRelease.name}</span
						>
					</p>
				</div>

				<div class="homepage-actions-list">
					{#each quickActions as action}
						<button
							type="button"
							class="homepage-action-btn border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-700/80 {action.primary
								? 'is-primary'
								: ''}"
							on:click={() => handleQuickAction(action)}
						>
							<span
								class="homepage-action-icon bg-slate-100 text-blue-600 dark:bg-slate-900 dark:text-blue-400"
								aria-hidden="true"
							>
								<svg class="homepage-action-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={action.icon}
									/>
								</svg>
							</span>
							<span class="homepage-action-text">
								<span
									class="homepage-action-label text-slate-900 dark:text-slate-100"
									>{action.label}</span
								>
								<span
									class="homepage-action-desc text-slate-500 dark:text-slate-400"
									>{action.id === 'browse'
										? `Open full CRD catalog for ${$selectedRelease.name}`
										: action.description}</span
								>
							</span>
							{#if action.primary}
								<svg
									class="homepage-action-arrow homepage-action-svg"
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
	</main>
</div>
