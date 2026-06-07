<script lang="ts">
	import yaml from 'js-yaml';
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
	import {
		CHANGE_COLORS,
		HIGH_RISK_CHANGE_TYPES,
		RISK_COLOR,
		TABS
	} from '$lib/release-notes/constants';
	import HighlightText from '$lib/release-notes/HighlightText.svelte';
	import {
		breakingProductionImpact,
		changeRowKey,
		comparisonPageHref,
		displayNetworkBehavior,
		filterBreakingChanges,
		filterDeprecatedItems,
		filterModifiedResources,
		filterNewResources,
		groupBreakingByKind,
		groupModifiedByOperationalArea,
		humanizeFieldPath,
		partitionFieldChanges,
		sortBreakingChanges,
		sortDeprecatedItems,
		sortFieldChanges,
		sortNewResources,
		statSparkHeights,
		type ListSortMode
	} from '$lib/release-notes/presentation';
	import {
		fetchAllReleaseNotes,
		fetchReleaseNotesEntry,
		fetchReleaseNotesIndex
	} from '$lib/release-notes/loadStatic';
	import type { DeprecatedItem, ReleaseNotes, ReleaseNotesEntry } from '$lib/release-notes/types';
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

	function breakingCount(notes: ReleaseNotes): number {
		return notes.totalBreakingCount ?? notes.breakingChanges.length;
	}

	let releaseHistory: ReleaseNotesEntry[] = $state([]);
	let selected: string | null = $state(null);
	let toast: string | null = $state(null);
	let globalLoading = $state(true);
	let loadingMsg = $state('Loading release notes...');
	let activeTab = $state(0);
	let injectOpen = $state(false);
	let injectVersion = $state('');
	let copiedCode: string | null = $state(null);
	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;
	const manifestCache = getManifestCache();

	let breakingFilter = $state('');
	let breakingSort = $state<ListSortMode>('severity');
	let breakingKindExpanded = $state<Record<string, boolean>>({});
	let breakingRowExpanded = $state<Record<string, boolean>>({});

	let modifiedFilter = $state('');
	let modifiedSort = $state<ListSortMode>('severity');
	let modifiedKindExpanded = $state<Record<string, boolean>>({});
	let modifiedRowExpanded = $state<Record<string, boolean>>({});
	let showSchemaMetadata = $state(false);

	let newFilter = $state('');
	let newSort = $state<ListSortMode>('kind-asc');

	let deprecFilter = $state('');
	let deprecSort = $state<ListSortMode>('severity');
	let deprecRowExpanded = $state<Record<string, boolean>>({});

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
		deprecRowExpanded = {};
		breakingFilter = '';
		breakingKindExpanded = {};
		breakingRowExpanded = {};
		modifiedFilter = '';
		modifiedKindExpanded = {};
		modifiedRowExpanded = {};
		showSchemaMetadata = false;
		newFilter = '';
	}

	async function handleInject() {
		const version = injectVersion.trim();
		if (!version) return;

		const release = releasesConfig.releases.find((r) => r.name === version);
		if (!release) {
			showToast('Release not found');
			return;
		}

		if (releaseHistory.some((e) => e.toVer === version)) {
			selected = version;
			activeTab = 0;
			injectOpen = false;
			injectVersion = '';
			showToast(`Release ${version} is already in the timeline`);
			return;
		}

		const entry = await fetchReleaseNotesEntry(version);
		if (!entry) {
			showToast('Regenerate release notes (npm run generate:release-notes)');
			return;
		}

		releaseHistory = [entry, ...releaseHistory].sort((a, b) =>
			b.toVer.localeCompare(a.toVer, undefined, { numeric: true })
		);
		selected = version;
		activeTab = 0;
		injectOpen = false;
		injectVersion = '';
		resetTabState();

		const count = breakingCount(entry.notes);
		showToast(
			`Release ${version} loaded (${entry.source}) — ${count} breaking change${count !== 1 ? 's' : ''}`
		);
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
			{ label: 'New', value: notes.newResources.length, tone: 'new' as const },
			{ label: 'Removed', value: notes.removedResources.length, tone: 'removed' as const },
			{ label: 'Modified', value: notes.modifiedResources.length, tone: 'modified' as const },
			{ label: 'Breaking', value: breakingCount(notes), tone: 'breaking' as const },
			{
				label: 'Deprecated',
				value: countDeprecatedApiVersions(notes.deprecated),
				tone: 'deprecated' as const
			}
		];
	}

	function toggleKindExpanded(map: Record<string, boolean>, key: string, defaultOpen = true) {
		return { ...map, [key]: !(map[key] ?? defaultOpen) };
	}

	function isKindExpanded(map: Record<string, boolean>, key: string, defaultOpen = true): boolean {
		return map[key] ?? defaultOpen;
	}

	function toggleRowExpanded(map: Record<string, boolean>, key: string) {
		return { ...map, [key]: !map[key] };
	}

	function isRowExpanded(map: Record<string, boolean>, key: string): boolean {
		return map[key] ?? false;
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
			{ label: 'break', value: breakingCount(notes), tone: 'breaking' as const },
			{
				label: 'dep',
				value: countDeprecatedApiVersions(notes.deprecated),
				tone: 'deprecated' as const
			}
		].filter((p) => p.value > 0);
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
		content="Structured release notes for Nokia EDA upgrades — breaking changes, new CRDs, and upgrade risk."
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
				<div class="rn-inject">
					<button type="button" class="rn-inject-toggle" onclick={() => (injectOpen = !injectOpen)}>
						<span class="rn-inject-plus">+</span> Inject new release
					</button>
					{#if injectOpen}
						<div class="rn-inject-panel">
							<div class="rn-inject-hint">
								Load precomputed notes for a release in the project list
							</div>
							<div class="rn-inject-row">
								<input
									class="rn-inject-input"
									bind:value={injectVersion}
									placeholder="e.g. 26.4.2"
									onkeydown={(e) => e.key === 'Enter' && handleInject()}
								/>
								<button type="button" class="rn-inject-btn" onclick={handleInject}>Load</button>
							</div>
							<div class="rn-inject-note">
								Notes are precomputed at build time from schema diffs. Regenerate if a file is missing.
							</div>
						</div>
					{/if}
				</div>

				{#if globalLoading}
					<div class="rn-loading-msg">{loadingMsg}</div>
				{/if}

				<div class="rn-timeline">
					<div class="rn-timeline-line" aria-hidden="true"></div>
					{#each releaseHistory as entry, i (entry.toVer)}
						{@const risk = entry.notes.upgradeRisk}
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
								class:rn-timeline-dot--pulse={breakingCount(entry.notes) > 0}
								style:background={RISK_COLOR[risk]}
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
								<span class="rn-timeline-risk" style:color={RISK_COLOR[risk]}>{risk}</span>
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
					{#if breakingCount(selectedEntry.notes) > 0}
						<div class="rn-alert" role="alert">
							<span class="rn-alert-icon">⚠</span>
							<div>
								<span class="rn-alert-title">
									{breakingCount(selectedEntry.notes)} breaking change{breakingCount(
										selectedEntry.notes
									) !== 1
										? 's'
										: ''}
								</span>
								<span class="rn-alert-sub">
									— existing manifests require updates before applying this release
								</span>
							</div>
						</div>
					{/if}

					<header class="rn-header">
						<div class="rn-header-row">
							<h1>EDA {selectedEntry.toVer}</h1>
							<span class="rn-risk-badge rn-risk-badge--{selectedEntry.notes.upgradeRisk}">
								{selectedEntry.notes.upgradeRisk}
							</span>
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
							<span>{selectedEntry.notes.estimatedEffort}</span>
							<span class="rn-source-badge">{selectedEntry.source}</span>
							<a
								class="rn-action-link"
								href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
							>
								Open schema comparison →
							</a>
						</div>
					</header>

					<div class="rn-tabs-wrap">
						<div class="rn-tabs" role="tablist">
							{#each TABS as tab, i (tab)}
								{@const breakingN = breakingCount(selectedEntry.notes)}
								{@const deprecN = countDeprecatedApiVersions(selectedEntry.notes.deprecated)}
								<button
									type="button"
									role="tab"
									class="rn-tab"
									class:rn-tab--active={activeTab === i}
									aria-selected={activeTab === i}
									onclick={() => (activeTab = i)}
								>
									{tab}
									{#if i === 1 && breakingN > 0}
										<span class="rn-tab-count">{breakingN}</span>
									{:else if i === 2 && deprecN > 0}
										<span class="rn-tab-count rn-tab-count--warn">{deprecN}</span>
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
								<div class="rn-stat-grid">
									{#each stats as stat, i (stat.label)}
										<button
											type="button"
											class="rn-stat-cell"
											class:rn-stat-cell--interactive={stat.value > 0}
											onclick={() => {
												if (stat.label === 'Breaking') activeTab = 1;
												else if (stat.label === 'Deprecated') activeTab = 2;
												else if (stat.label === 'New') activeTab = 3;
												else if (stat.label === 'Modified') activeTab = 4;
											}}
										>
											<span class="rn-stat-value rn-stat-value--{stat.tone}">{stat.value}</span>
											<span class="rn-stat-label">{stat.label}</span>
											<span class="rn-stat-spark" aria-hidden="true">
												<span
													class="rn-stat-spark-bar"
													style:height="{sparkHeights[i]}%"
												></span>
											</span>
										</button>
									{/each}
								</div>
								<div class="rn-overview-actions">
									<a
										class="rn-btn rn-btn--secondary"
										href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
									>
										Deep-dive in Comparison
									</a>
								</div>
							{:else if activeTab === 1}
								{#if selectedEntry.notes.breakingChanges.length === 0}
									<div class="rn-empty">
										<span class="rn-empty-icon">✓</span>
										No breaking changes in this release
									</div>
								{:else}
									{@const filteredBreaking = sortBreakingChanges(
										filterBreakingChanges(
											selectedEntry.notes.breakingChanges,
											breakingFilter
										),
										breakingSort
									)}
									{@const groupedBreaking = groupBreakingByKind(filteredBreaking)}
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--breaking">Breaking</span>
											<span class="rn-toolbar-text">
												{breakingCount(selectedEntry.notes)} total · {groupedBreaking.length} kind{groupedBreaking.length !==
												1
													? 's'
													: ''}
											</span>
										</div>
										<div class="rn-toolbar-controls">
											<select class="rn-select" bind:value={breakingSort} aria-label="Sort breaking">
												{#each SORT_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<input
												class="rn-search"
												type="search"
												placeholder="Filter kind, field, impact…"
												bind:value={breakingFilter}
												aria-label="Filter breaking changes"
											/>
										</div>
									</div>

									{#if groupedBreaking.length === 0}
										<div class="rn-empty">No breaking changes match your filter</div>
									{:else}
										<div class="rn-group-list">
											{#each groupedBreaking as group (group.kind)}
												<div class="rn-card rn-group">
													<div
														class="rn-group-head"
														role="button"
														tabindex="0"
														aria-expanded={isKindExpanded(
															breakingKindExpanded,
															group.kind
														)}
														onclick={() =>
															(breakingKindExpanded = toggleKindExpanded(
																breakingKindExpanded,
																group.kind
															))}
														onkeydown={(e) =>
															collapsibleKeydown(e, () =>
																(breakingKindExpanded = toggleKindExpanded(
																	breakingKindExpanded,
																	group.kind
																)))}
													>
														<span
															class="rn-chevron"
															class:rn-chevron--open={isKindExpanded(
																breakingKindExpanded,
																group.kind
															)}>›</span
														>
														<button
															type="button"
															class="rn-kind-link"
															onclick={(e) => openKindModal(group.kind, undefined, undefined, e)}
														>
															<HighlightText text={group.kind} query={breakingFilter} />
														</button>
														<span class="rn-group-count"
															>{group.items.length} change{group.items.length !== 1
																? 's'
																: ''}</span
														>
													</div>

													{#if isKindExpanded(breakingKindExpanded, group.kind)}
														<div class="rn-group-body">
															{#each group.items as b, i (changeRowKey(group.kind, b.field, i))}
																{@const rowKey = changeRowKey(group.kind, b.field, i)}
																{@const expanded = isRowExpanded(breakingRowExpanded, rowKey)}
																<div class="rn-change-card" class:rn-change-card--open={expanded}>
																	<div
																		class="rn-change-summary"
																		role="button"
																		tabindex="0"
																		aria-expanded={expanded}
																		onclick={() =>
																			(breakingRowExpanded = toggleRowExpanded(
																				breakingRowExpanded,
																				rowKey
																			))}
																		onkeydown={(e) =>
																			collapsibleKeydown(e, () =>
																				(breakingRowExpanded = toggleRowExpanded(
																					breakingRowExpanded,
																					rowKey
																				)))}
																	>
																		<span
																			class="rn-chevron rn-chevron--sm"
																			class:rn-chevron--open={expanded}>›</span
																		>
																		<div class="rn-change-summary-body">
																			<p class="rn-production-impact">
																				<HighlightText
																					text={breakingProductionImpact(b)}
																					query={breakingFilter}
																				/>
																			</p>
																			<div class="rn-change-head rn-change-head--compact">
																				<span class="rn-badge rn-badge--breaking">Breaking</span>
																				{#if b.severity === 'critical'}
																					<span class="rn-badge rn-badge--critical">critical</span>
																				{:else if b.severity === 'warning'}
																					<span class="rn-badge rn-badge--warning">warning</span>
																				{/if}
																				<span class="rn-field-label">
																					<HighlightText
																						text={humanizeFieldPath(b.field)}
																						query={breakingFilter}
																					/>
																				</span>
																				<code class="rn-field-path">{b.field}</code>
																			</div>
																		</div>
																	</div>

																	{#if expanded}
																		<div class="rn-change-detail">
																			<p class="rn-prose rn-prose--sm">
																				<HighlightText text={b.description} query={breakingFilter} />
																			</p>
																			{#if b.migrationSteps.length > 0}
																				<div class="rn-migration">
																					<div class="rn-section-label">Migration steps</div>
																					{#each b.migrationSteps as step, j (j)}
																						<div class="rn-migration-step">
																							<span class="rn-migration-num">{j + 1}.</span>
																							<span>{step}</span>
																						</div>
																					{/each}
																				</div>
																			{/if}
																			{#if b.yamlBefore || b.yamlAfter}
																				<div class="rn-yaml-grid">
																					{#if b.yamlBefore}
																						<div>
																							<div class="rn-yaml-label rn-yaml-label--before">
																								Before
																							</div>
																							<div class="rn-codeblock">
																								<pre>{b.yamlBefore}</pre>
																								<button
																									type="button"
																									class="rn-copy"
																									onclick={() =>
																										copyText(b.yamlBefore, 'before YAML')}
																								>
																									{copiedCode === b.yamlBefore
																										? '✓ copied'
																										: 'copy'}
																								</button>
																							</div>
																						</div>
																					{/if}
																					{#if b.yamlAfter}
																						<div>
																							<div class="rn-yaml-label rn-yaml-label--after">
																								After
																							</div>
																							<div class="rn-codeblock">
																								<pre>{b.yamlAfter}</pre>
																								<button
																									type="button"
																									class="rn-copy"
																									onclick={() =>
																										copyText(b.yamlAfter, 'after YAML')}
																								>
																									{copiedCode === b.yamlAfter
																										? '✓ copied'
																										: 'copy'}
																								</button>
																							</div>
																						</div>
																					{/if}
																				</div>
																			{/if}
																		</div>
																	{/if}
																</div>
															{/each}
														</div>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								{/if}
							{:else if activeTab === 2}
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
												{@const rowKey = d.crdName}
												{@const expanded = isRowExpanded(deprecRowExpanded, rowKey)}
												<article class="rn-card rn-deprec-item" class:rn-deprec-item--open={expanded}>
													<div
														class="rn-deprec-summary"
														role="button"
														tabindex="0"
														aria-expanded={expanded}
														onclick={() =>
															(deprecRowExpanded = toggleRowExpanded(
																deprecRowExpanded,
																rowKey
															))}
														onkeydown={(e) =>
															collapsibleKeydown(e, () =>
																(deprecRowExpanded = toggleRowExpanded(
																	deprecRowExpanded,
																	rowKey
																)))}
													>
														<span
															class="rn-chevron"
															class:rn-chevron--open={expanded}>›</span
														>
														<div class="rn-deprec-summary-body">
															<div class="rn-deprec-item-header">
																<button
																	type="button"
																	class="rn-kind-link rn-deprec-kind"
																	onclick={(e) =>
																		openKindModal(d.kind, d.group, d.crdName, e)}
																>
																	<HighlightText text={d.kind} query={deprecFilter} />
																</button>
																<span class="rn-deprec-group">
																	<HighlightText text={d.group} query={deprecFilter} />
																</span>
															</div>

															{#if d.recommendedApiVersion}
																<div class="rn-action-chip-row">
																	<button
																		type="button"
																		class="rn-action-chip rn-action-chip--success"
																		onclick={(e) => {
																			e.stopPropagation();
																			copyText(
																				d.recommendedApiVersion!,
																				'recommended apiVersion'
																			);
																		}}
																	>
																		<span class="rn-action-chip-label">Migrate to</span>
																		<span class="rn-action-chip-value"
																			>{d.recommendedApiVersion}</span
																		>
																		<span class="rn-action-chip-action">copy</span>
																	</button>
																</div>
															{/if}

															<div class="rn-chip-row">
																{#each d.deprecatedVersions as v (v.apiVersion)}
																	<span
																		class="rn-chip"
																		class:rn-chip--highlight={v.newInRelease}
																	>
																		<span class="rn-chip-label">apiVersion</span>
																		<span class="rn-chip-value">{v.version}</span>
																		<button
																			type="button"
																			class="rn-chip-copy"
																			onclick={(e) => {
																				e.stopPropagation();
																				copyText(v.apiVersion, 'apiVersion');
																			}}
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
													</div>

													{#if expanded}
														<div class="rn-deprec-detail">
															<div class="rn-deprec-detail-row">
																<div class="rn-section-label">Removed in</div>
																<span class="rn-deprec-removed">
																	{removedInLabel(d.deprecatedVersions[0])}
																</span>
															</div>
															<p class="rn-deprec-migration">{d.migrationPath}</p>
														</div>
													{/if}
												</article>
											{/each}
										</div>
									{/if}
								{/if}
							{:else if activeTab === 3}
								{#if selectedEntry.notes.newResources.length === 0}
									<div class="rn-empty">
										<span class="rn-empty-icon">✦</span>
										No new resources in this release
									</div>
								{:else}
									{@const newItems = sortNewResources(
										filterNewResources(selectedEntry.notes.newResources, newFilter),
										newSort
									)}
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--new">New</span>
											<span class="rn-toolbar-text">
												{selectedEntry.notes.newResources.length} CRD{selectedEntry.notes
													.newResources.length !== 1
													? 's'
													: ''}
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
												placeholder="Filter by kind or apiVersion…"
												bind:value={newFilter}
												aria-label="Filter new resources"
											/>
										</div>
									</div>
									{#if newItems.length === 0}
										<div class="rn-empty">No new resources match your filter</div>
									{:else}
										<div class="rn-new-grid">
											{#each newItems as r, i (`${r.kind}-${r.apiVersion}-${i}`)}
												<div class="rn-card rn-new-card">
													<div class="rn-new-card-head">
														<button
															type="button"
															class="rn-kind-link rn-new-kind"
															onclick={() => openKindModal(r.kind)}
														>
															<HighlightText text={r.kind} query={newFilter} />
														</button>
														<span class="rn-badge rn-badge--new">New</span>
													</div>
													<div class="rn-api-version-row">
														<span class="rn-api-version">
															<HighlightText text={r.apiVersion} query={newFilter} />
														</span>
														<button
															type="button"
															class="rn-chip-copy"
															onclick={() => copyText(r.apiVersion, 'apiVersion')}
														>
															copy
														</button>
													</div>
													<p class="rn-prose rn-prose--sm">
														<HighlightText text={r.description} query={newFilter} />
													</p>
												</div>
											{/each}
										</div>
									{/if}
								{/if}
							{:else if activeTab === 4}
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
									{@const totalChanges = selectedEntry.notes.modifiedResources.reduce(
										(n, r) => n + r.changes.length,
										0
									)}
									{@const metadataCount = filteredModified.reduce((n, r) => {
										const { metadata } = partitionFieldChanges(r.changes);
										return n + metadata.length;
									}, 0)}
									<div class="rn-toolbar">
										<div class="rn-toolbar-summary">
											<span class="rn-badge rn-badge--modified">Modified</span>
											<span class="rn-toolbar-text">
												{selectedEntry.notes.modifiedResources.length} CRD{selectedEntry.notes
													.modifiedResources.length !== 1
													? 's'
													: ''} · {totalChanges} field change{totalChanges !== 1 ? 's' : ''}
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
																			{@const rowKey = changeRowKey(r.kind, c.field, j)}
																			{@const expanded = isRowExpanded(
																				modifiedRowExpanded,
																				rowKey
																			)}
																			{@const col = CHANGE_COLORS[c.changeType] ?? '#86868b'}
																			<div
																				class="rn-change-card"
																				class:rn-change-card--open={expanded}
																			>
																				<div
																					class="rn-change-summary"
																					role="button"
																					tabindex="0"
																					aria-expanded={expanded}
																					onclick={() =>
																						(modifiedRowExpanded = toggleRowExpanded(
																							modifiedRowExpanded,
																							rowKey
																						))}
																					onkeydown={(e) =>
																						collapsibleKeydown(e, () =>
																							(modifiedRowExpanded = toggleRowExpanded(
																								modifiedRowExpanded,
																								rowKey
																							)))}
																				>
																					<span
																						class="rn-chevron rn-chevron--sm"
																						class:rn-chevron--open={expanded}>›</span
																					>
																					<div class="rn-change-summary-body">
																						<p class="rn-impact">
																							<HighlightText
																								text={displayNetworkBehavior(c, r.kind)}
																								query={modifiedFilter}
																							/>
																						</p>
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
																							{#if HIGH_RISK_CHANGE_TYPES.has(c.changeType)}
																								<span class="rn-badge rn-badge--breaking"
																									>high risk</span
																								>
																							{/if}
																						</div>
																						{#if c.before || c.after}
																							<div class="rn-diff-pills">
																								<span class="rn-diff-pill rn-diff-pill--before">
																									<span class="rn-diff-pill-label">Before</span>
																									<span class="rn-diff-pill-value"
																										>{c.before || '—'}</span
																									>
																								</span>
																								<span class="rn-diff-arrow" aria-hidden="true"
																									>→</span
																								>
																								<span class="rn-diff-pill rn-diff-pill--after">
																									<span class="rn-diff-pill-label">After</span>
																									<span class="rn-diff-pill-value"
																										>{c.after || '—'}</span
																									>
																								</span>
																							</div>
																						{/if}
																					</div>
																				</div>

																				{#if expanded}
																					<div class="rn-change-detail">
																						<code class="rn-field-path">{c.field}</code>
																						{#if r.apiVersion}
																							<div class="rn-api-version-row">
																								<span class="rn-api-version">{r.apiVersion}</span
																								>
																								<button
																									type="button"
																									class="rn-chip-copy"
																									onclick={() =>
																										copyText(r.apiVersion!, 'apiVersion')}
																								>
																									copy apiVersion
																								</button>
																							</div>
																						{/if}
																					</div>
																				{/if}
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
							{:else if activeTab === 5}
								{@const risk = selectedEntry.notes.upgradeRisk}
								<div class="rn-card rn-risk-hero">
									<div class="rn-risk-ring" style:color={RISK_COLOR[risk]}>◉</div>
									<div>
										<div class="rn-section-label">Upgrade risk</div>
										<div class="rn-risk-title" style:color={RISK_COLOR[risk]}>{risk}</div>
										<div class="rn-risk-sub">
											{selectedEntry.fromVer} → {selectedEntry.toVer}
										</div>
									</div>
								</div>
								{#if selectedEntry.notes.upgradeRiskJustification}
									<div class="rn-card rn-card-pad">
										<div class="rn-section-label">Justification</div>
										<p class="rn-prose">{selectedEntry.notes.upgradeRiskJustification}</p>
									</div>
								{/if}
								{#if selectedEntry.notes.estimatedEffort}
									<div class="rn-card rn-card-pad">
										<div class="rn-section-label">Estimated effort</div>
										<div class="rn-effort">{selectedEntry.notes.estimatedEffort}</div>
									</div>
								{/if}
								<div class="rn-overview-actions">
									<a
										class="rn-btn rn-btn--secondary"
										href={comparisonPageHref(selectedEntry.fromVer, selectedEntry.toVer)}
									>
										Compare schemas for this upgrade
									</a>
								</div>
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
