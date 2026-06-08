<script lang="ts">
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import { sortReleasesByVersion } from '$lib/release-notes/generateNotes';
	import {
		countDeprecatedApiVersions,
		countNewlyDeprecatedApiVersions,
		removedInLabel
	} from '$lib/release-notes/deprecation';
	import { CHANGE_COLORS, RISK_COLOR, TAB_ICONS, TABS } from '$lib/release-notes/constants';
	import HighlightText from '$lib/release-notes/HighlightText.svelte';
	import {
		catalogBrowseHref,
		changeRowKey,
		comparisonPageHref,
		countOperationalChanges,
		displayNetworkBehavior,
		filterDeprecatedItems,
		filterModifiedResources,
		filterNewResources,
		groupModifiedByOperationalArea,
		groupNewResourcesByKind,
		groupNewResourcesByOperationalArea,
		humanizeFieldPath,
		inferReleaseTone,
		partitionFieldChanges,
		sortDeprecatedItems,
		sortFieldChanges,
		statSparkHeights,
		type ListSortMode
	} from '$lib/release-notes/presentation';
	import { fetchAllReleaseNotes, fetchReleaseNotesIndex } from '$lib/release-notes/loadStatic';
	import type { ReleaseNotes, ReleaseNotesEntry } from '$lib/release-notes/types';
	import { fetchManifest, getManifestCache, type ManifestResource } from '$lib/manifest';
	import { getLatestVersion } from '$lib/versions';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';

	const SORT_OPTIONS: { value: ListSortMode; label: string }[] = [
		{ value: 'kind-asc', label: 'Kind A→Z' },
		{ value: 'kind-desc', label: 'Kind Z→A' },
		{ value: 'severity', label: 'Severity' },
		{ value: 'change-type', label: 'Change type' }
	];

	let releaseHistory: ReleaseNotesEntry[] = $state([]);
	let selected: string | null = $state(null);
	let toast: string | null = $state(null);
	let globalLoading = $state(true);
	let loadingMsg = $state('Loading release notes...');
	let activeTab = $state(0);
	let copiedCode: string | null = $state(null);
	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
	const manifestCache = getManifestCache();

	let modifiedFilter = $state('');
	let modifiedSort = $state<ListSortMode>('severity');
	let modifiedKindExpanded = $state<Record<string, boolean>>({});
	let showSchemaMetadata = $state(false);

	let newFilter = $state('');
	let newSort = $state<ListSortMode>('kind-asc');

	let deprecFilter = $state('');
	let deprecSort = $state<ListSortMode>('severity');

	let modalOpen = $state(false);
	let modalResource: CrdResource | null = $state(null);
	let modalVersion: string | null = $state(null);
	let manifestResources: ManifestResource[] = $state([]);

	const sortedReleases = sortReleasesByVersion(releasesConfig.releases);
	const latestVersion =
		sortedReleases[0]?.name ??
		releasesConfig.releases.find((r) => r.default)?.name ??
		releasesConfig.releases[0]?.name ??
		'';

	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showToast(message: string) {
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast = null;
		}, 4000);
	}

	function collapsibleKeydown(e: KeyboardEvent, action: () => void) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			action();
		}
	}

	function resetTabState() {
		deprecFilter = '';
		modifiedFilter = '';
		modifiedKindExpanded = {};
		showSchemaMetadata = false;
		newFilter = '';
	}

	function copyText(text: string, label?: string) {
		void navigator.clipboard.writeText(text);
		copiedCode = text;
		showToast(label ? `Copied ${label}` : 'Copied to clipboard');
		setTimeout(() => {
			if (copiedCode === text) copiedCode = null;
		}, 1500);
	}

	function isNewEntry(entry: ReleaseNotesEntry, index: number): boolean {
		return index === 0 && Date.now() - entry.timestamp < 5000;
	}

	function statItems(notes: ReleaseNotes) {
		return [
			{ label: 'New', value: notes.newResources.length, tone: 'new' as const, tab: 2 },
			{
				label: 'Removed',
				value: notes.removedResources.length,
				tone: 'removed' as const,
				tab: null
			},
			{
				label: 'Modified',
				value: notes.modifiedResources.length,
				tone: 'modified' as const,
				tab: 3
			},
			{
				label: 'Deprecated',
				value: countDeprecatedApiVersions(notes.deprecated),
				tone: 'deprecated' as const,
				tab: 1
			}
		];
	}

	function toggleKindExpanded(map: Record<string, boolean>, key: string, defaultOpen = true) {
		return { ...map, [key]: !(map[key] ?? defaultOpen) };
	}

	function isKindExpanded(map: Record<string, boolean>, key: string, defaultOpen = true): boolean {
		return map[key] ?? defaultOpen;
	}

	function releaseForVersion(version: string): EdaRelease | null {
		return releasesConfig.releases.find((r) => r.name === version) ?? null;
	}

	async function loadManifestForSelected() {
		if (!selectedEntry) return;
		const release = releaseForVersion(selectedEntry.toVer);
		if (!release) return;
		manifestResources = (await fetchManifest(release.folder, manifestCache)) || [];
	}

	function resolveCrdResource(
		kind: string,
		group?: string,
		crdName?: string
	): CrdResource | null {
		if (crdName) {
			const byName = manifestResources.find((r) => r.name === crdName);
			if (byName) return byName as CrdResource;
		}
		if (group) {
			const byGroup = manifestResources.find((r) => r.kind === kind && r.group === group);
			if (byGroup) return byGroup as CrdResource;
		}
		const byKind = manifestResources.find((r) => r.kind === kind);
		return (byKind as CrdResource | undefined) ?? null;
	}

	async function openKindModal(kind: string, group?: string, crdName?: string, event?: Event) {
		event?.stopPropagation();
		if (!selectedEntry) return;
		await loadManifestForSelected();
		const resource = resolveCrdResource(kind, group, crdName);
		if (!resource) {
			showToast(`CRD schema not found for ${kind}`);
			return;
		}
		modalResource = resource;
		modalVersion = getLatestVersion(resource);
		modalOpen = true;
	}

	function closeKindModal() {
		modalOpen = false;
		modalResource = null;
		modalVersion = null;
	}

	function timelineStatPills(notes: ReleaseNotes) {
		return [
			{
				label: 'new',
				value: notes.newResources.length,
				tone: 'new' as const
			},
			{
				label: 'mod',
				value: countOperationalChanges(notes),
				tone: 'modified' as const
			},
			{
				label: 'dep',
				value: countDeprecatedApiVersions(notes.deprecated),
				tone: 'deprecated' as const
			}
		].filter((p) => p.value > 0);
	}

	function overviewSummary(notes: ReleaseNotes, fromVer: string, toVer: string): string {
		const parts: string[] = [];
		if (notes.newResources.length > 0) {
			parts.push(
				`${notes.newResources.length} new CRD${notes.newResources.length !== 1 ? 's' : ''}`
			);
		}
		if (notes.modifiedResources.length > 0) {
			parts.push(
				`${countOperationalChanges(notes)} spec change${countOperationalChanges(notes) !== 1 ? 's' : ''} across ${notes.modifiedResources.length} resource${notes.modifiedResources.length !== 1 ? 's' : ''}`
			);
		}
		if (notes.deprecated.length > 0) {
			parts.push(
				`${countDeprecatedApiVersions(notes.deprecated)} deprecated apiVersion${countDeprecatedApiVersions(notes.deprecated) !== 1 ? 's' : ''}`
			);
		}
		if (notes.removedResources.length > 0) {
			parts.push(
				`${notes.removedResources.length} removed resource${notes.removedResources.length !== 1 ? 's' : ''}`
			);
		}
		if (parts.length === 0) {
			return `No schema changes detected between EDA ${fromVer} and ${toVer}.`;
		}
		return `Upgrade from ${fromVer} to ${toVer}: ${parts.join(' · ')}.`;
	}

	const selectedEntry = $derived(releaseHistory.find((e) => e.toVer === selected) ?? null);
	const selectedRelease = $derived(
		selectedEntry ? releaseForVersion(selectedEntry.toVer) : null
	);

	$effect(() => {
		if (selectedEntry?.toVer) {
			void loadManifestForSelected();
		}
	});

	onMount(async () => {
		globalLoading = true;
		loadingMsg = 'Loading release notes...';

		const index = await fetchReleaseNotesIndex();
		if (!index) {
			showToast('Release notes missing — run npm run generate:release-notes');
			globalLoading = false;
			return;
		}

		releaseHistory = await fetchAllReleaseNotes(index);
		globalLoading = false;
		selected = index.latest || latestVersion;
	});
</script>

<svelte:head>
	<title>EDA Resource Browser | Release Notes</title>
	<meta
		name="description"
		content="Structured release notes for Nokia EDA upgrades — deprecations, new CRDs, and schema changes."
	/>
</svelte:head>

<div class="release-notes-page spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="rn-shell">
		<aside class="rn-sidebar">
			<div class="rn-sidebar-header">
				<div class="rn-sidebar-kicker">Nokia EDA</div>
				<div class="rn-sidebar-title">Release Intelligence</div>
			</div>

			<div class="rn-sidebar-body">
				{#if globalLoading}
					<div class="rn-loading-msg">{loadingMsg}</div>
				{/if}

				<div class="rn-timeline">
					<div class="rn-timeline-line" aria-hidden="true"></div>
					{#each releaseHistory as entry, i (entry.toVer)}
						{@const tone = inferReleaseTone(entry.fromVer, entry.toVer)}
						{@const isSelected = selected === entry.toVer}
						{@const pills = timelineStatPills(entry.notes)}
						<button
							type="button"
							class="rn-timeline-item"
							class:rn-timeline-item--selected={isSelected}
							onclick={() => {
								selected = entry.toVer;
								activeTab = 0;
								resetTabState();
							}}
						>
							<span
								class="rn-timeline-dot"
								style:background={RISK_COLOR[tone]}
							></span>
							<div class="rn-timeline-version">
								<span
									class="rn-timeline-version-text"
									class:rn-timeline-version-text--active={isSelected}>{entry.toVer}</span
								>
								{#if isNewEntry(entry, i)}
									<span class="rn-tag rn-tag--new">NEW</span>
								{/if}
								{#if entry.toVer === latestVersion}
									<span class="rn-tag rn-tag--latest">latest</span>
								{/if}
							</div>
							<div class="rn-timeline-meta">
								{entry.fromVer} → {entry.toVer}
								{#if entry.source === 'mock'}
									<span class="rn-source-badge">{entry.source}</span>
								{/if}
							</div>
							{#if pills.length > 0}
								<div class="rn-timeline-pills">
									{#each pills as pill (pill.label)}
										<span class="rn-timeline-pill rn-timeline-pill--{pill.tone}">
											{pill.value} {pill.label}
										</span>
									{/each}
								</div>
							{/if}
						</button>
					{/each}

					{#if globalLoading}
						{#each sortedReleases.slice(0, 4) as r (r.name)}
							<div class="rn-timeline-skeleton">
								<span class="rn-timeline-dot rn-timeline-dot--skeleton"></span>
								<div class="rn-skeleton-text">{r.name}</div>
								<div class="rn-skeleton-sub">Loading...</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</aside>

		<main class="rn-main">
			{#if selectedEntry && selectedRelease}
				<div class="rn-main-inner">
					<header class="rn-header">
						<div class="rn-header-row">
							<h1>EDA {selectedEntry.toVer}</h1>
							{#if selectedEntry.toVer === latestVersion}
								<span class="rn-tag rn-tag--latest">latest</span>
							{/if}
						</div>
						<div class="rn-header-meta">
							<span class="rn-version-path">
								<span class="rn-version-path-from">{selectedEntry.fromVer}</span>
								<span class="rn-version-arrow" aria-hidden="true">→</span>
								<span class="rn-version-path-to">{selectedEntry.toVer}</span>
							</span>
							<span class="rn-source-badge">{selectedEntry.source}</span>
							<a
								class="rn-action-link rn-action-link--prominent"
								href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
							>
								View full comparison →
							</a>
						</div>
					</header>

					<div class="rn-tabs-wrap">
						<div class="rn-tabs" role="tablist">
							{#each TABS as tab, i (tab)}
								{@const deprecN = countDeprecatedApiVersions(selectedEntry.notes.deprecated)}
								{@const newN = selectedEntry.notes.newResources.length}
								{@const modN = selectedEntry.notes.modifiedResources.length}
								<button
									type="button"
									role="tab"
									class="rn-tab"
									class:rn-tab--active={activeTab === i}
									aria-selected={activeTab === i}
									onclick={() => (activeTab = i)}
								>
									<span class="rn-tab-icon" aria-hidden="true">{TAB_ICONS[i]}</span>
									{tab}
									{#if i === 1 && deprecN > 0}
										<span class="rn-tab-count rn-tab-count--warn">{deprecN}</span>
									{:else if i === 2 && newN > 0}
										<span class="rn-tab-count rn-tab-count--new">{newN}</span>
									{:else if i === 3 && modN > 0}
										<span class="rn-tab-count rn-tab-count--mod">{modN}</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>

					{#key activeTab}
						<div class="rn-tab-panel rn-tab-panel--animate" role="tabpanel">
							{#if activeTab === 0}
								{@const stats = statItems(selectedEntry.notes)}
								{@const sparkHeights = statSparkHeights(stats.map((s) => s.value))}
								<p class="rn-overview-summary">
									{overviewSummary(
										selectedEntry.notes,
										selectedEntry.fromVer,
										selectedEntry.toVer
									)}
								</p>
								<div class="rn-stat-grid">
									{#each stats as stat, i (stat.label)}
										<button
											type="button"
											class="rn-stat-cell"
											class:rn-stat-cell--interactive={stat.value > 0 && stat.tab !== null}
											disabled={stat.tab === null || stat.value === 0}
											onclick={() => {
												if (stat.tab !== null && stat.value > 0) activeTab = stat.tab;
											}}
										>
											<span class="rn-stat-value rn-stat-value--{stat.tone}">{stat.value}</span>
											<span class="rn-stat-label">{stat.label}</span>
											<span class="rn-stat-spark" aria-hidden="true">
												<span
													class="rn-stat-spark-bar rn-stat-spark-bar--{stat.tone}"
													style:height="{sparkHeights[i]}%"
												></span>
											</span>
										</button>
									{/each}
								</div>
								{#if selectedEntry.notes.removedResources.length > 0}
									<section class="rn-removed-section">
										<h3 class="rn-section-label">Removed resources</h3>
										<ul class="rn-removed-list">
											{#each selectedEntry.notes.removedResources as r (`${r.kind}-${r.apiVersion}`)}
												<li class="rn-removed-item">
													<span
														class="text-[15px] font-semibold text-slate-900 dark:text-slate-100"
														>{r.kind}</span
													>
													<span
														class="font-mono text-[13px] text-slate-500 dark:text-slate-400"
														>{r.apiVersion}</span
													>
													{#if r.reason}
														<p
															class="mb-0 mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
														>
															{r.reason}
														</p>
													{/if}
												</li>
											{/each}
										</ul>
									</section>
								{/if}
								<div class="rn-overview-actions">
									<a
										class="rn-btn rn-btn--secondary"
										href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
									>
										Deep-dive in Comparison
									</a>
								</div>
							{:else if activeTab === 1}
								{#if selectedEntry.notes.deprecated.length === 0}
									<div class="rn-empty">
										<span class="rn-empty-icon">⊘</span>
										No deprecations in this release
									</div>
								{:else}
									{@const deprecItems = sortDeprecatedItems(
										filterDeprecatedItems(selectedEntry.notes.deprecated, deprecFilter),
										deprecSort
									)}
									{@const newCount = countNewlyDeprecatedApiVersions(
										selectedEntry.notes.deprecated
									)}
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--deprec">Deprecated</span>
											<span class="rn-toolbar-text">
												{selectedEntry.notes.deprecated.length} resource{selectedEntry.notes
													.deprecated.length !== 1
													? 's'
													: ''} · {countDeprecatedApiVersions(
													selectedEntry.notes.deprecated
												)} apiVersion{countDeprecatedApiVersions(
													selectedEntry.notes.deprecated
												) !== 1
													? 's'
													: ''}
												{#if newCount > 0}
													· <strong>{newCount} new in this release</strong>
												{/if}
											</span>
										</div>
										<div class="rn-toolbar-controls">
											<select class="rn-select" bind:value={deprecSort} aria-label="Sort deprecated">
												{#each SORT_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<input
												class="rn-search"
												type="search"
												placeholder="Filter kind, group, version…"
												bind:value={deprecFilter}
												aria-label="Filter deprecated resources"
											/>
										</div>
									</div>

									{#if deprecItems.length === 0}
										<div class="rn-empty">No resources match your filter</div>
									{:else}
										<div class="rn-deprec-list">
											{#each deprecItems as d (d.crdName)}
												<article class="rn-deprec-card">
													<div class="rn-deprec-card-layout">
														<div class="rn-deprec-card-main">
															<button
																type="button"
																class="rn-deprec-kind-btn"
																onclick={() =>
																	openKindModal(d.kind, d.group, d.crdName)}
															>
																<span
																	class="text-[17px] font-bold leading-snug text-slate-900 dark:text-slate-100"
																>
																	<HighlightText text={d.kind} query={deprecFilter} />
																</span>
															</button>
															<span
																class="mt-0.5 block font-mono text-[13px] text-slate-500 dark:text-slate-400"
															>
																<HighlightText text={d.group} query={deprecFilter} />
															</span>
															<p
																class="rn-deprec-migration-oneline mb-0 mt-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
															>
																{d.migrationPath}
															</p>
															{#if d.recommendedApiVersion}
																<div class="rn-action-chip-row mt-3">
																	<button
																		type="button"
																		class="rn-action-chip rn-action-chip--success"
																		onclick={() =>
																			copyText(
																				d.recommendedApiVersion!,
																				'recommended apiVersion'
																			)}
																	>
																		<span class="rn-action-chip-label">Migrate to</span>
																		<span
																			class="font-mono text-[13px] font-semibold text-green-700 dark:text-green-300"
																			>{d.recommendedApiVersion}</span
																		>
																		<span class="rn-action-chip-action">copy</span>
																	</button>
																</div>
															{/if}
														</div>

														<div class="rn-deprec-card-aside">
															{#each d.deprecatedVersions as v (v.apiVersion)}
																<span
																	class="rn-deprec-version-pill"
																	class:rn-deprec-version-pill--new={v.newInRelease}
																>
																	<span
																		class="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
																		>apiVersion</span
																	>
																	<span
																		class="font-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100"
																		>{v.version}</span
																	>
																	<button
																		type="button"
																		class="rn-chip-copy"
																		onclick={() => copyText(v.apiVersion, 'apiVersion')}
																	>
																		copy
																	</button>
																	{#if v.newInRelease}
																		<span class="rn-badge rn-badge--new">new</span>
																	{/if}
																</span>
															{/each}
														</div>
													</div>

													<details class="rn-deprec-details">
														<summary
															class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
														>
															Removal timeline
														</summary>
														<p
															class="mt-2 mb-0 text-sm text-slate-600 dark:text-slate-300"
														>
															{removedInLabel(d.deprecatedVersions[0])}
														</p>
													</details>
												</article>
											{/each}
										</div>
									{/if}
								{/if}
							{:else if activeTab === 2}
								{#if selectedEntry.notes.newResources.length === 0}
									<div class="rn-empty">
										<span class="rn-empty-icon">✦</span>
										No new resources in this release
									</div>
								{:else}
									{@const filteredNew = filterNewResources(
										selectedEntry.notes.newResources,
										newFilter
									)}
									{@const groupedNew = groupNewResourcesByKind(filteredNew)}
									{@const newAreaGroups = groupNewResourcesByOperationalArea(
										groupedNew,
										newSort
									)}
									{@const newApiVersionCount = filteredNew.length}
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--new">New</span>
											<span class="rn-toolbar-text">
												{groupedNew.length} resource{groupedNew.length !== 1 ? 's' : ''} ·
												{newApiVersionCount} apiVersion{newApiVersionCount !== 1 ? 's' : ''}
											</span>
										</div>
										<div class="rn-toolbar-controls">
											<select class="rn-select" bind:value={newSort} aria-label="Sort new resources">
												{#each SORT_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<input
												class="rn-search"
												type="search"
												placeholder="Filter kind, group, apiVersion…"
												bind:value={newFilter}
												aria-label="Filter new resources"
											/>
										</div>
									</div>
									{#if groupedNew.length === 0}
										<div class="rn-empty">No new resources match your filter</div>
									{:else}
										{#each newAreaGroups as og (og.area)}
											<section class="rn-area-section">
												<h3 class="rn-area-title">
													{og.area}
													<span class="rn-area-count">{og.resources.length}</span>
												</h3>
												<div class="rn-new-list">
													{#each og.resources as r (r.kind)}
														<article class="rn-new-card">
															<div class="rn-new-card-layout">
																<div class="rn-new-card-main">
																	<button
																		type="button"
																		class="rn-new-kind-btn"
																		onclick={() =>
																			openKindModal(r.kind, r.group, r.crdName)}
																	>
																		<span
																			class="text-[17px] font-bold leading-snug text-slate-900 dark:text-slate-100"
																		>
																			<HighlightText text={r.kind} query={newFilter} />
																		</span>
																	</button>
																	<span
																		class="mt-0.5 block font-mono text-[13px] text-slate-500 dark:text-slate-400"
																	>
																		<HighlightText text={r.group} query={newFilter} />
																	</span>
																	<p
																		class="mb-0 mt-2.5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200"
																	>
																		<HighlightText text={r.description} query={newFilter} />
																	</p>
																	<div class="rn-new-actions mt-3">
																		<a
																			class="rn-action-link"
																			href={catalogBrowseHref(
																				selectedEntry.toVer,
																				r.crdName
																			)}
																		>
																			Browse in catalog →
																		</a>
																	</div>
																</div>

																<div class="rn-new-card-aside">
																	{#each r.apiVersions as v (v.apiVersion)}
																		<span class="rn-new-version-pill">
																			<span
																				class="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
																				>apiVersion</span
																			>
																			<span
																				class="font-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100"
																			>
																				<HighlightText
																					text={v.apiVersion}
																					query={newFilter}
																				/>
																			</span>
																			<button
																				type="button"
																				class="rn-chip-copy"
																				onclick={() => copyText(v.apiVersion, 'apiVersion')}
																			>
																				copy
																			</button>
																			<span class="rn-badge rn-badge--new">NEW</span>
																		</span>
																	{/each}
																</div>
															</div>
														</article>
													{/each}
												</div>
											</section>
										{/each}
									{/if}
								{/if}
							{:else if activeTab === 3}
								{#if selectedEntry.notes.modifiedResources.length === 0}
									<div class="rn-empty">
										<span class="rn-empty-icon">✎</span>
										No field-level modifications in this release
									</div>
								{:else}
									{@const filteredModified = filterModifiedResources(
										selectedEntry.notes.modifiedResources,
										modifiedFilter
									)}
									{@const operationalGroups = groupModifiedByOperationalArea(filteredModified)}
									{@const totalChanges = countOperationalChanges(selectedEntry.notes)}
									{@const metadataCount = filteredModified.reduce((n, r) => {
										const { metadata } = partitionFieldChanges(r.changes);
										return n + metadata.length;
									}, 0)}
									<div class="rn-comparison-cta">
										<a
											class="rn-btn rn-btn--secondary"
											href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
										>
											View full comparison →
										</a>
									</div>
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--modified">Modified</span>
											<span class="rn-toolbar-text">
												{selectedEntry.notes.modifiedResources.length} CRD{selectedEntry.notes
													.modifiedResources.length !== 1
													? 's'
													: ''} · {totalChanges} spec change{totalChanges !== 1 ? 's' : ''}
											</span>
										</div>
										<div class="rn-toolbar-controls">
											<select
												class="rn-select"
												bind:value={modifiedSort}
												aria-label="Sort modified changes"
											>
												{#each SORT_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<input
												class="rn-search"
												type="search"
												placeholder="Filter kind, field, behavior…"
												bind:value={modifiedFilter}
												aria-label="Filter modified resources"
											/>
										</div>
									</div>

									{#if operationalGroups.length === 0 && !showSchemaMetadata}
										<div class="rn-empty">No modifications match your filter</div>
									{:else}
										{#each operationalGroups as og (og.area)}
											<section class="rn-area-section">
												<h3 class="rn-area-title">{og.area}</h3>
												<div class="rn-group-list">
													{#each og.resources as r (r.kind)}
														{@const partitioned = partitionFieldChanges(r.changes)}
														{@const visibleChanges = sortFieldChanges(
															showSchemaMetadata
																? r.changes
																: partitioned.operational,
															modifiedSort
														)}
														{#if visibleChanges.length > 0}
															<div class="rn-card rn-group">
																<div
																	class="rn-group-head"
																	role="button"
																	tabindex="0"
																	aria-expanded={isKindExpanded(
																		modifiedKindExpanded,
																		r.kind
																	)}
																	onclick={() =>
																		(modifiedKindExpanded = toggleKindExpanded(
																			modifiedKindExpanded,
																			r.kind
																		))}
																	onkeydown={(e) =>
																		collapsibleKeydown(e, () =>
																			(modifiedKindExpanded = toggleKindExpanded(
																				modifiedKindExpanded,
																				r.kind
																			)))}
																>
																	<span
																		class="rn-chevron"
																		class:rn-chevron--open={isKindExpanded(
																			modifiedKindExpanded,
																			r.kind
																		)}>›</span
																	>
																	<button
																		type="button"
																		class="rn-kind-link rn-group-kind"
																		onclick={(e) => openKindModal(r.kind, undefined, undefined, e)}
																	>
																		<HighlightText text={r.kind} query={modifiedFilter} />
																	</button>
																	<span class="rn-group-count"
																		>{visibleChanges.length} change{visibleChanges.length !==
																		1
																			? 's'
																			: ''}</span
																	>
																</div>

																{#if isKindExpanded(modifiedKindExpanded, r.kind)}
																	<div class="rn-group-body">
																		{#each visibleChanges as c, j (changeRowKey(r.kind, c.field, j))}
																			{@const col = CHANGE_COLORS[c.changeType] ?? '#86868b'}
																			<div class="rn-change-card rn-change-card--flat">
																				<div class="rn-change-summary-body">
																					<div class="rn-change-head rn-change-head--compact">
																						<span class="rn-field-label">
																							<HighlightText
																								text={humanizeFieldPath(c.field)}
																								query={modifiedFilter}
																							/>
																						</span>
																						<span
																							class="rn-change-type-badge"
																							style:background="{col}18"
																							style:color={col}
																							style:border-color="{col}55"
																						>
																							{c.changeType.replace(/_/g, ' ')}
																						</span>
																					</div>
																					{#if c.before || c.after}
																						<div class="rn-diff-pills">
																							<span class="rn-diff-pill rn-diff-pill--before">
																								<span class="rn-diff-pill-label">Before</span>
																								<span class="rn-diff-pill-value">{c.before || '—'}</span>
																							</span>
																							<span class="rn-diff-arrow" aria-hidden="true">→</span>
																							<span class="rn-diff-pill rn-diff-pill--after">
																								<span class="rn-diff-pill-label">After</span>
																								<span class="rn-diff-pill-value">{c.after || '—'}</span>
																							</span>
																						</div>
																					{/if}
																					<p class="rn-impact">
																						<HighlightText
																							text={displayNetworkBehavior(c, r.kind)}
																							query={modifiedFilter}
																						/>
																					</p>
																					<code class="rn-field-path">{c.field}</code>
																				</div>
																			</div>
																		{/each}
																	</div>
																{/if}
															</div>
														{/if}
													{/each}
												</div>
											</section>
										{/each}

										{#if metadataCount > 0}
											<div class="rn-metadata-toggle-wrap">
												<button
													type="button"
													class="rn-metadata-toggle"
													aria-expanded={showSchemaMetadata}
													onclick={() => (showSchemaMetadata = !showSchemaMetadata)}
												>
													<span
														class="rn-chevron"
														class:rn-chevron--open={showSchemaMetadata}>›</span
													>
													{showSchemaMetadata ? 'Hide' : 'Show'} schema metadata ({metadataCount})
												</button>
											</div>
										{/if}
									{/if}
								{/if}
							{/if}
						</div>
					{/key}

					<PageCredits />
				</div>
			{:else}
				<div class="rn-main-empty">
					<div class="rn-main-empty-icon">◈</div>
					<p>{loadingMsg}</p>
				</div>
			{/if}
		</main>
	</div>

	{#if toast}
		<div class="rn-toast" role="status">{toast}</div>
	{/if}
</div>

{#if modalOpen && modalResource && selectedRelease}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={selectedRelease}
		allReleases={releasesConfig.releases}
		initialVersion={modalVersion}
		onClose={closeKindModal}
	/>
{/if}
