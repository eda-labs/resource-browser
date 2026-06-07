<script lang="ts">
	import yaml from 'js-yaml';
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
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
	import {
		filterBreakingChanges,
		filterModifiedResources,
		filterNewResources,
		groupBreakingByKind,
		groupModifiedByKind
	} from '$lib/release-notes/presentation';
	import {
		fetchAllReleaseNotes,
		fetchReleaseNotesEntry,
		fetchReleaseNotesIndex
	} from '$lib/release-notes/loadStatic';
	import type { ReleaseNotes, ReleaseNotesEntry } from '$lib/release-notes/types';
	import releasesYaml from '$lib/releases.yaml?raw';

	import type { ReleasesConfig } from '$lib/structure';

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

	let breakingFilter = $state('');
	let breakingExpanded = $state<Record<string, boolean>>({});
	let modifiedFilter = $state('');
	let modifiedExpanded = $state<Record<string, boolean>>({});
	let newFilter = $state('');
	let deprecFilter = $state('');
	let deprecExpanded = $state<Record<string, boolean>>({});

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

		const count = breakingCount(entry.notes);
		showToast(
			`Release ${version} loaded (${entry.source}) — ${count} breaking change${count !== 1 ? 's' : ''}`
		);
	}

	function copyText(text: string) {
		void navigator.clipboard.writeText(text);
		copiedCode = text;
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

	function toggleBreakingKind(kind: string) {
		breakingExpanded = { ...breakingExpanded, [kind]: !breakingExpanded[kind] };
	}

	function isBreakingExpanded(kind: string): boolean {
		return breakingExpanded[kind] ?? true;
	}

	function toggleModifiedKind(kind: string) {
		modifiedExpanded = { ...modifiedExpanded, [kind]: !modifiedExpanded[kind] };
	}

	function isModifiedExpanded(kind: string): boolean {
		return modifiedExpanded[kind] ?? true;
	}

	function filteredDeprecated(notes: ReleaseNotes) {
		const q = deprecFilter.trim().toLowerCase();
		if (!q) return notes.deprecated;
		return notes.deprecated.filter(
			(d) =>
				d.kind.toLowerCase().includes(q) ||
				d.group.toLowerCase().includes(q) ||
				d.crdName.toLowerCase().includes(q) ||
				d.deprecatedVersions.some((v) => v.version.toLowerCase().includes(q))
		);
	}

	function toggleDeprecKind(crdName: string) {
		deprecExpanded = { ...deprecExpanded, [crdName]: !deprecExpanded[crdName] };
	}

	function isDeprecExpanded(crdName: string): boolean {
		return deprecExpanded[crdName] ?? false;
	}

	function hasMigrationDetail(d: (typeof releaseHistory)[0]['notes']['deprecated'][0]): boolean {
		return Boolean(d.recommendedApiVersion || d.migrationPath || d.deprecatedVersions.length > 0);
	}

	const selectedEntry = $derived(releaseHistory.find((e) => e.toVer === selected) ?? null);

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

<div class="release-notes-page">
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
						<button
							type="button"
							class="rn-timeline-item"
							class:rn-timeline-item--selected={isSelected}
							onclick={() => {
								selected = entry.toVer;
								activeTab = 0;
								deprecFilter = '';
								deprecExpanded = {};
								breakingFilter = '';
								breakingExpanded = {};
								modifiedFilter = '';
								modifiedExpanded = {};
								newFilter = '';
							}}
						>
							<span class="rn-timeline-dot" style:background={RISK_COLOR[risk]}></span>
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
								<span style:color={RISK_COLOR[risk]}> · {risk}</span>
								{#if entry.source === 'mock'}
									<span class="rn-source-badge">{entry.source}</span>
								{/if}
							</div>
							{#if breakingCount(entry.notes) > 0}
								<div class="rn-timeline-breaking">
									{breakingCount(entry.notes)} breaking
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
			{#if selectedEntry}
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

					<div class="rn-tab-panel" role="tabpanel">
						{#if activeTab === 0}
							<div class="rn-stat-grid">
								{#each statItems(selectedEntry.notes) as stat (stat.label)}
									<div class="rn-stat-cell">
										<span class="rn-stat-value rn-stat-value--{stat.tone}">{stat.value}</span>
										<span class="rn-stat-label">{stat.label}</span>
									</div>
								{/each}
							</div>
						{:else if activeTab === 1}
							{#if selectedEntry.notes.breakingChanges.length === 0}
								<div class="rn-empty">
									<span class="rn-empty-icon">✓</span>
									No breaking changes in this release
								</div>
							{:else}
								{@const filteredBreaking = filterBreakingChanges(
									selectedEntry.notes.breakingChanges,
									breakingFilter
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
									<input
										class="rn-search"
										type="search"
										placeholder="Filter by kind, field, or description…"
										bind:value={breakingFilter}
										aria-label="Filter breaking changes"
									/>
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
													aria-expanded={isBreakingExpanded(group.kind)}
													onclick={() => toggleBreakingKind(group.kind)}
													onkeydown={(e) =>
														collapsibleKeydown(e, () => toggleBreakingKind(group.kind))}
												>
													<span
														class="rn-chevron"
														class:rn-chevron--open={isBreakingExpanded(group.kind)}>›</span
													>
													<span class="rn-group-kind">{group.kind}</span>
													<span class="rn-group-count"
														>{group.items.length} change{group.items.length !== 1
															? 's'
															: ''}</span
													>
												</div>

												{#if isBreakingExpanded(group.kind)}
													<div class="rn-group-body">
														{#each group.items as b, i (`${group.kind}-${b.field}-${i}`)}
															<div class="rn-change-card">
																<div class="rn-change-head">
																	<span class="rn-badge rn-badge--breaking">Breaking</span>
																	{#if b.severity === 'critical'}
																		<span class="rn-badge rn-badge--critical">critical</span>
																	{:else if b.severity === 'warning'}
																		<span class="rn-badge rn-badge--warning">warning</span>
																	{/if}
																	<span class="rn-field-name">{b.field}</span>
																</div>
																<p class="rn-prose rn-prose--sm">{b.description}</p>
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
																				<div class="rn-yaml-label rn-yaml-label--before">Before</div>
																				<div class="rn-codeblock">
																					<pre>{b.yamlBefore}</pre>
																					<button
																						type="button"
																						class="rn-copy"
																						onclick={() => copyText(b.yamlBefore)}
																					>
																						{copiedCode === b.yamlBefore ? '✓ copied' : 'copy'}
																					</button>
																				</div>
																			</div>
																		{/if}
																		{#if b.yamlAfter}
																			<div>
																				<div class="rn-yaml-label rn-yaml-label--after">After</div>
																				<div class="rn-codeblock">
																					<pre>{b.yamlAfter}</pre>
																					<button
																						type="button"
																						class="rn-copy"
																						onclick={() => copyText(b.yamlAfter)}
																					>
																						{copiedCode === b.yamlAfter ? '✓ copied' : 'copy'}
																					</button>
																				</div>
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
								{@const deprecItems = filteredDeprecated(selectedEntry.notes)}
								{@const newCount = countNewlyDeprecatedApiVersions(selectedEntry.notes.deprecated)}
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
									<input
										class="rn-search"
										type="search"
										placeholder="Filter by kind, group, or version…"
										bind:value={deprecFilter}
										aria-label="Filter deprecated resources"
									/>
								</div>

								{#if deprecItems.length === 0}
									<div class="rn-empty">No resources match your filter</div>
								{:else}
									<div class="rn-deprec-list">
										{#each deprecItems as d (d.crdName)}
											<article class="rn-card rn-deprec-item">
												<div class="rn-deprec-item-header">
													<span class="rn-deprec-kind">{d.kind}</span>
													<span class="rn-deprec-group">{d.group}</span>
												</div>

												<div class="rn-chip-row">
													{#each d.deprecatedVersions as v (v.apiVersion)}
														<span class="rn-chip" class:rn-chip--highlight={v.newInRelease}>
															<span class="rn-chip-label">apiVersion</span>
															<span class="rn-chip-value">{v.version}</span>
															{#if v.newInRelease}
																<span class="rn-badge rn-badge--new">new</span>
															{/if}
														</span>
													{/each}
												</div>

												{#if hasMigrationDetail(d)}
													<div
														class="rn-collapsible-head"
														role="button"
														tabindex="0"
														aria-expanded={isDeprecExpanded(d.crdName)}
														onclick={() => toggleDeprecKind(d.crdName)}
														onkeydown={(e) =>
															collapsibleKeydown(e, () => toggleDeprecKind(d.crdName))}
													>
														<span
															class="rn-chevron"
															class:rn-chevron--open={isDeprecExpanded(d.crdName)}>›</span
														>
														<span>Migration guidance</span>
													</div>

													{#if isDeprecExpanded(d.crdName)}
														<div class="rn-deprec-detail">
															{#if d.recommendedApiVersion}
																<div class="rn-deprec-detail-row">
																	<div class="rn-section-label">Use instead</div>
																	<span class="rn-deprec-recommended">{d.recommendedApiVersion}</span>
																</div>
															{/if}
															<div class="rn-deprec-detail-row">
																<div class="rn-section-label">Removed in</div>
																<span class="rn-deprec-removed">
																	{removedInLabel(d.deprecatedVersions[0])}
																</span>
															</div>
															<p class="rn-deprec-migration">{d.migrationPath}</p>
														</div>
													{/if}
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
								{@const newItems = filterNewResources(
									selectedEntry.notes.newResources,
									newFilter
								)}
								<div class="rn-toolbar">
									<div class="rn-toolbar-summary">
										<span class="rn-badge rn-badge--new">New</span>
										<span class="rn-toolbar-text">
											{selectedEntry.notes.newResources.length} CRD{selectedEntry.notes.newResources
												.length !== 1
												? 's'
												: ''}
										</span>
									</div>
									<input
										class="rn-search"
										type="search"
										placeholder="Filter by kind or apiVersion…"
										bind:value={newFilter}
										aria-label="Filter new resources"
									/>
								</div>
								{#if newItems.length === 0}
									<div class="rn-empty">No new resources match your filter</div>
								{:else}
									<div class="rn-new-grid">
										{#each newItems as r, i (`${r.kind}-${i}`)}
											<div class="rn-card rn-new-card">
												<div class="rn-new-card-head">
													<span class="rn-new-kind">{r.kind}</span>
													<span class="rn-badge rn-badge--new">New</span>
												</div>
												<div class="rn-api-version">{r.apiVersion}</div>
												<p class="rn-prose rn-prose--sm">{r.description}</p>
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
								{@const modifiedItems = groupModifiedByKind(
									filterModifiedResources(selectedEntry.notes.modifiedResources, modifiedFilter)
								)}
								{@const totalChanges = selectedEntry.notes.modifiedResources.reduce(
									(n, r) => n + r.changes.length,
									0
								)}
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
									<input
										class="rn-search"
										type="search"
										placeholder="Filter by kind or field path…"
										bind:value={modifiedFilter}
										aria-label="Filter modified resources"
									/>
								</div>

								{#if modifiedItems.length === 0}
									<div class="rn-empty">No modifications match your filter</div>
								{:else}
									<div class="rn-group-list">
										{#each modifiedItems as r (r.kind)}
											<div class="rn-card rn-group">
												<div
													class="rn-group-head"
													role="button"
													tabindex="0"
													aria-expanded={isModifiedExpanded(r.kind)}
													onclick={() => toggleModifiedKind(r.kind)}
													onkeydown={(e) =>
														collapsibleKeydown(e, () => toggleModifiedKind(r.kind))}
												>
													<span
														class="rn-chevron"
														class:rn-chevron--open={isModifiedExpanded(r.kind)}>›</span
													>
													<span class="rn-group-kind">{r.kind}</span>
													<span class="rn-group-count"
														>{r.changes.length} change{r.changes.length !== 1 ? 's' : ''}</span
													>
												</div>
												{#if isModifiedExpanded(r.kind)}
													<div class="rn-group-body">
														{#each r.changes as c, j (`${r.kind}-${c.field}-${j}`)}
															{@const col = CHANGE_COLORS[c.changeType] ?? '#86868b'}
															<div class="rn-change-card">
																<div class="rn-change-head">
																	<span class="rn-field-name">{c.field}</span>
																	<span
																		class="rn-change-type-badge"
																		style:background="{col}18"
																		style:color={col}
																		style:border-color="{col}55"
																	>
																		{c.changeType.replace(/_/g, ' ')}
																	</span>
																	{#if HIGH_RISK_CHANGE_TYPES.has(c.changeType)}
																		<span class="rn-badge rn-badge--breaking">high risk</span>
																	{/if}
																</div>
																<div class="rn-values">
																	<div class="rn-val-row">
																		<span class="rn-val-label">Before</span>
																		{#if c.before}
																			<span class="rn-val-before">{c.before}</span>
																		{:else}
																			<span class="rn-val-empty">—</span>
																		{/if}
																	</div>
																	<div class="rn-val-row">
																		<span class="rn-val-label">After</span>
																		{#if c.after}
																			<span class="rn-val-after">{c.after}</span>
																		{:else}
																			<span class="rn-val-empty">—</span>
																		{/if}
																	</div>
																</div>
																{#if c.networkBehavior}
																	<p class="rn-impact">{c.networkBehavior}</p>
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
						{/if}
					</div>

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
