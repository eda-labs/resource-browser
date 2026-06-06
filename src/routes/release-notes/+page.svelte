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
		TAB_ICONS,
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
			{ label: 'New', value: notes.newResources.length, color: '#639922' },
			{ label: 'Removed', value: notes.removedResources.length, color: '#e24b4a' },
			{ label: 'Modified', value: notes.modifiedResources.length, color: '#ef9f27' },
			{ label: 'Breaking', value: breakingCount(notes), color: '#e24b4a' },
			{
				label: 'Deprecated',
				value: countDeprecatedApiVersions(notes.deprecated),
				color: '#ef9f27'
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
		return deprecExpanded[crdName] ?? true;
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

<div class="rn-page">
	<AppHeader fixed={false} />

	<div class="rn-shell">
		<!-- Sidebar -->
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
								<span class:rn-timeline-version--active={isSelected}>{entry.toVer}</span>
								{#if isNewEntry(entry, i)}
									<span class="rn-tag rn-tag--new">NEW</span>
								{/if}
								{#if entry.toVer === latestVersion}
									<span class="rn-tag rn-tag--latest">latest</span>
								{/if}
							</div>
							<div class="rn-timeline-meta">
								from {entry.fromVer}
								<span style:color={RISK_COLOR[risk]}>● {risk}</span>
								{#if entry.source === 'mock'}
									<span class="rn-source-badge">mock</span>
								{/if}
							</div>
							{#if breakingCount(entry.notes) > 0}
								<div class="rn-timeline-breaking">
									⚠ {breakingCount(entry.notes)} breaking
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

		<!-- Main -->
		<main class="rn-main">
			{#if selectedEntry}
				<div class="rn-main-inner">
					{#if breakingCount(selectedEntry.notes) > 0}
						<div class="rn-breaking-banner" role="alert">
							<span class="rn-breaking-icon">⚠</span>
							<div>
								<strong
									>{breakingCount(selectedEntry.notes)} breaking change{breakingCount(
										selectedEntry.notes
									) !== 1
										? 's'
										: ''}</strong
								>
								<span class="rn-breaking-sub">
									— existing manifests require updates before applying this release
								</span>
							</div>
						</div>
					{/if}

					<header class="rn-header">
						<div>
							<div class="rn-header-row">
								<h1>EDA {selectedEntry.toVer}</h1>
								<span
									class="rn-risk-badge rn-risk-badge--lg rn-risk-badge--{selectedEntry.notes.upgradeRisk}"
								>
									{selectedEntry.notes.upgradeRisk}
								</span>
								{#if selectedEntry.toVer === latestVersion}
									<span class="rn-tag rn-tag--latest">latest</span>
								{/if}
							</div>
							<p class="rn-header-sub">
								Schema changes from {selectedEntry.fromVer} · {selectedEntry.notes.estimatedEffort}
								· source: {selectedEntry.source}
							</p>
						</div>
					</header>

					<!-- Tabs -->
					<div class="rn-tabs" role="tablist">
						{#each TABS as tab, i (tab)}
							{@const hasWarning =
								(i === 1 && breakingCount(selectedEntry.notes) > 0) ||
								(i === 2 && selectedEntry.notes.deprecated.length > 0)}
							<button
								type="button"
								role="tab"
								class="rn-tab"
								class:rn-tab--active={activeTab === i}
								aria-selected={activeTab === i}
								onclick={() => (activeTab = i)}
							>
								<span class="rn-tab-icon">{TAB_ICONS[i]}</span>
								{tab}
								{#if hasWarning}
									<span class="rn-tab-badge">
										{i === 1
											? breakingCount(selectedEntry.notes)
											: countDeprecatedApiVersions(selectedEntry.notes.deprecated)}
									</span>
								{/if}
							</button>
						{/each}
					</div>

					<!-- Tab panels -->
					<div class="rn-tab-panel" role="tabpanel">
						{#if activeTab === 0}
							<div class="rn-stats">
								{#each statItems(selectedEntry.notes) as stat (stat.label)}
									<div class="rn-stat">
										<span class="rn-stat-value" style:color={stat.color}>{stat.value}</span>
										<span class="rn-stat-label">{stat.label}</span>
									</div>
								{/each}
							</div>
						{:else if activeTab === 1}
							{#if selectedEntry.notes.breakingChanges.length === 0}
								<div class="rn-empty">No breaking changes in this release ✓</div>
							{:else}
								{@const filteredBreaking = filterBreakingChanges(
									selectedEntry.notes.breakingChanges,
									breakingFilter
								)}
								{@const groupedBreaking = groupBreakingByKind(filteredBreaking)}
								<div class="rn-list-toolbar">
									<div class="rn-list-summary">
										<span class="rn-pill rn-pill--breaking">BREAKING</span>
										<span class="rn-list-summary-text">
											{breakingCount(selectedEntry.notes)} total · {groupedBreaking.length} kind{groupedBreaking.length !==
											1
												? 's'
												: ''}
										</span>
									</div>
									<input
										class="rn-list-search"
										type="search"
										placeholder="Filter by kind, field, or description…"
										bind:value={breakingFilter}
										aria-label="Filter breaking changes"
									/>
								</div>

								{#if groupedBreaking.length === 0}
									<div class="rn-empty">No breaking changes match your filter</div>
								{:else}
									<div class="rn-breaking-list">
										{#each groupedBreaking as group (group.kind)}
											<div class="rn-breaking-group">
												<button
													type="button"
													class="rn-breaking-group-head"
													aria-expanded={isBreakingExpanded(group.kind)}
													onclick={() => toggleBreakingKind(group.kind)}
												>
													<span
														class="rn-deprec-chevron"
														class:rn-deprec-chevron--open={isBreakingExpanded(group.kind)}>▸</span
													>
													<code class="rn-code-kind">{group.kind}</code>
													<span class="rn-muted">{group.items.length} change{group.items.length !== 1 ? 's' : ''}</span>
												</button>

												{#if isBreakingExpanded(group.kind)}
													<div class="rn-breaking-group-body">
														{#each group.items as b, i (`${group.kind}-${b.field}-${i}`)}
															<div class="rn-breaking-card">
																<div class="rn-breaking-card-head">
																	<span class="rn-pill rn-pill--breaking">BREAKING</span>
																	{#if b.severity === 'critical'}
																		<span class="rn-pill rn-pill--critical">critical</span>
																	{:else if b.severity === 'warning'}
																		<span class="rn-pill rn-pill--warning">warning</span>
																	{/if}
																	<code class="rn-code-field">{b.field}</code>
																</div>
																<p class="rn-prose rn-prose--sm">{b.description}</p>
																{#if b.migrationSteps.length > 0}
																	<div class="rn-migration">
																		<div class="rn-card-label">Migration steps</div>
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
																				<div class="rn-yaml-label rn-yaml-label--before">BEFORE</div>
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
																				<div class="rn-yaml-label rn-yaml-label--after">AFTER</div>
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
								<div class="rn-empty">No deprecations in this release</div>
							{:else}
								{@const deprecItems = filteredDeprecated(selectedEntry.notes)}
								{@const newCount = countNewlyDeprecatedApiVersions(selectedEntry.notes.deprecated)}
								<div class="rn-deprec-toolbar">
									<div class="rn-deprec-summary">
										<span class="rn-pill rn-pill--deprec">DEPRECATED</span>
										<span class="rn-deprec-summary-text">
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
										class="rn-deprec-search"
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
											<div class="rn-deprec-card">
												<button
													type="button"
													class="rn-deprec-card-head"
													aria-expanded={isDeprecExpanded(d.crdName)}
													onclick={() => toggleDeprecKind(d.crdName)}
												>
													<span
														class="rn-deprec-chevron"
														class:rn-deprec-chevron--open={isDeprecExpanded(d.crdName)}>▸</span
													>
													<div class="rn-deprec-card-title">
														<span class="rn-deprec-kind">{d.kind}</span>
														<span class="rn-deprec-group">{d.group}</span>
													</div>
													<span class="rn-deprec-count">
														{d.deprecatedVersions.length} version{d.deprecatedVersions.length !==
														1
															? 's'
															: ''}
													</span>
												</button>

												{#if isDeprecExpanded(d.crdName)}
													<div class="rn-deprec-card-body">
														<div class="rn-deprec-versions">
															<span class="rn-deprec-label">Deprecated apiVersions</span>
															<div class="rn-deprec-chips">
																{#each d.deprecatedVersions as v (v.apiVersion)}
																	<span
																		class="rn-deprec-chip"
																		class:rn-deprec-chip--new={v.newInRelease}
																	>
																		<span class="rn-deprec-chip-key">apiVersion</span>
																		<code class="rn-deprec-chip-val">{v.version}</code>
																		{#if v.newInRelease}
																			<span class="rn-deprec-chip-tag">new</span>
																		{/if}
																	</span>
																{/each}
															</div>
														</div>

														{#if d.recommendedApiVersion}
															<div class="rn-deprec-row">
																<span class="rn-deprec-label">Use instead</span>
																<code class="rn-deprec-recommended">{d.recommendedApiVersion}</code>
															</div>
														{/if}

														<div class="rn-deprec-row">
															<span class="rn-deprec-label">Removed in</span>
															<span class="rn-deprec-removed">
																{removedInLabel(d.deprecatedVersions[0])}
															</span>
														</div>

														<p class="rn-deprec-migration">{d.migrationPath}</p>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{/if}
						{:else if activeTab === 3}
							{#if selectedEntry.notes.newResources.length === 0}
								<div class="rn-empty">No new resources in this release</div>
							{:else}
								{@const newItems = filterNewResources(
									selectedEntry.notes.newResources,
									newFilter
								)}
								<div class="rn-list-toolbar">
									<div class="rn-list-summary">
										<span class="rn-pill rn-pill--new">NEW</span>
										<span class="rn-list-summary-text">
											{selectedEntry.notes.newResources.length} CRD{selectedEntry.notes.newResources
												.length !== 1
												? 's'
												: ''}
										</span>
									</div>
									<input
										class="rn-list-search"
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
											<div class="rn-new-card">
												<div class="rn-new-card-head">
													<code class="rn-code-new">{r.kind}</code>
													<span class="rn-pill rn-pill--new">NEW</span>
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
								<div class="rn-empty">No field-level modifications in this release</div>
							{:else}
								{@const modifiedItems = groupModifiedByKind(
									filterModifiedResources(selectedEntry.notes.modifiedResources, modifiedFilter)
								)}
								{@const totalChanges = selectedEntry.notes.modifiedResources.reduce(
									(n, r) => n + r.changes.length,
									0
								)}
								<div class="rn-list-toolbar">
									<div class="rn-list-summary">
										<span class="rn-pill rn-pill--modified">MODIFIED</span>
										<span class="rn-list-summary-text">
											{selectedEntry.notes.modifiedResources.length} CRD{selectedEntry.notes
												.modifiedResources.length !== 1
												? 's'
												: ''} · {totalChanges} field change{totalChanges !== 1 ? 's' : ''}
										</span>
									</div>
									<input
										class="rn-list-search"
										type="search"
										placeholder="Filter by kind or field path…"
										bind:value={modifiedFilter}
										aria-label="Filter modified resources"
									/>
								</div>

								{#if modifiedItems.length === 0}
									<div class="rn-empty">No modifications match your filter</div>
								{:else}
									<div class="rn-mod-list">
										{#each modifiedItems as r (r.kind)}
											<div class="rn-mod-group">
												<button
													type="button"
													class="rn-mod-head rn-mod-head--btn"
													aria-expanded={isModifiedExpanded(r.kind)}
													onclick={() => toggleModifiedKind(r.kind)}
												>
													<span
														class="rn-deprec-chevron"
														class:rn-deprec-chevron--open={isModifiedExpanded(r.kind)}>▸</span
													>
													<code>{r.kind}</code>
													<span class="rn-muted"
														>{r.changes.length} change{r.changes.length !== 1 ? 's' : ''}</span
													>
												</button>
												{#if isModifiedExpanded(r.kind)}
													<div class="rn-mod-table-wrap">
														<table class="rn-mod-table">
															<thead>
																<tr>
																	<th>Field</th>
																	<th>Change</th>
																	<th>Before</th>
																	<th>After</th>
																	<th>Impact</th>
																</tr>
															</thead>
															<tbody>
																{#each r.changes as c, j (`${r.kind}-${c.field}-${j}`)}
																	{@const col = CHANGE_COLORS[c.changeType] ?? '#888'}
																	<tr>
																		<td><code>{c.field}</code></td>
																		<td>
																			<span
																				class="rn-pill"
																				style:background="{col}22"
																				style:color={col}
																			>
																				{c.changeType.replace(/_/g, ' ')}
																			</span>
																			{#if HIGH_RISK_CHANGE_TYPES.has(c.changeType)}
																				<span class="rn-pill rn-pill--breaking">high risk</span>
																			{/if}
																		</td>
																		<td>
																			{#if c.before}
																				<code class="rn-val-before">{c.before}</code>
																			{:else}
																				<span class="rn-muted">—</span>
																			{/if}
																		</td>
																		<td>
																			{#if c.after}
																				<code class="rn-val-after">{c.after}</code>
																			{:else}
																				<span class="rn-muted">—</span>
																			{/if}
																		</td>
																		<td class="rn-mod-impact">{c.networkBehavior}</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{/if}
						{:else if activeTab === 5}
							{@const risk = selectedEntry.notes.upgradeRisk}
							<div class="rn-risk-hero">
								<div class="rn-risk-icon" style:color={RISK_COLOR[risk]}>◉</div>
								<div>
									<div class="rn-card-label">Upgrade risk</div>
									<div class="rn-risk-title" style:color={RISK_COLOR[risk]}>{risk}</div>
									<div class="rn-muted">
										{selectedEntry.fromVer} → {selectedEntry.toVer}
									</div>
								</div>
							</div>
							{#if selectedEntry.notes.upgradeRiskJustification}
								<div class="rn-card">
									<div class="rn-card-label">Justification</div>
									<p class="rn-prose rn-prose--sm">{selectedEntry.notes.upgradeRiskJustification}</p>
								</div>
							{/if}
							{#if selectedEntry.notes.estimatedEffort}
								<div class="rn-card">
									<div class="rn-card-label">Estimated effort</div>
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

<style>
	.rn-page {
		--rn-bg: #ffffff;
		--rn-bg-elevated: #f8fafc;
		--rn-bg-surface: #f1f5f9;
		--rn-bg-code: #f8fafc;
		--rn-border: #e2e8f0;
		--rn-border-muted: #cbd5e1;
		--rn-text: #0f172a;
		--rn-heading: #0f172a;
		--rn-text-muted: #64748b;
		--rn-text-subtle: #94a3b8;
		--rn-accent: #2563eb;
		--rn-warning-fg: #ef9f27;
		--rn-success-fg: #639922;
		--rn-danger-fg: #e24b4a;
		--rn-breaking-bg: #fef2f2;
		--rn-breaking-border: rgb(226 75 74 / 0.35);
		--rn-deprec-bg: #fffbeb;
		--rn-deprec-border: rgb(239 159 39 / 0.35);
		--rn-new-bg: #f0fdf4;
		--rn-new-border: rgb(99 153 34 / 0.35);
		--rn-code-fg: #15803d;
		--rn-code-kind: #0369a1;
		--rn-code-new: #15803d;
		--rn-tab-active: #2563eb;
		--rn-scroll-track: #f1f5f9;
		--rn-scroll-thumb: #cbd5e1;
		--rn-selected-bg: #f1f5f9;
		--rn-latest-bg: #dcfce7;
		--rn-latest-text: #15803d;
		--rn-btn-primary: #2563eb;
		--rn-timeline-dot-ring: #ffffff;
		--rn-prose: #1e293b;
		--rn-migration: #334155;
		--rn-copy-border: #cbd5e1;
		--rn-copy-text: #64748b;
		--rn-skeleton-sub: #94a3b8;
		--rn-risk-high-bg: #fcebeb;
		--rn-risk-high-fg: #e24b4a;
		--rn-risk-medium-bg: #faeeda;
		--rn-risk-medium-fg: #ef9f27;
		--rn-risk-low-bg: #eaf3de;
		--rn-risk-low-fg: #639922;

		min-height: 100vh;
		background: var(--rn-bg);
		color: var(--rn-text);
		font-family: system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	:global(.dark) .rn-page {
		--rn-bg: #0d1117;
		--rn-bg-elevated: #161b22;
		--rn-bg-surface: #1c2128;
		--rn-bg-code: #0d1117;
		--rn-border: #30363d;
		--rn-border-muted: #484f58;
		--rn-text: #e6edf3;
		--rn-heading: #f0f6fc;
		--rn-text-muted: #b1bac4;
		--rn-text-subtle: #9da5ae;
		--rn-accent: #58a6ff;
		--rn-warning-fg: #ffa657;
		--rn-success-fg: #7ee787;
		--rn-danger-fg: #ff7b72;
		--rn-breaking-bg: rgb(226 75 74 / 0.1);
		--rn-breaking-border: rgb(226 75 74 / 0.45);
		--rn-deprec-bg: rgb(239 159 39 / 0.08);
		--rn-deprec-border: rgb(239 159 39 / 0.45);
		--rn-new-bg: rgb(99 153 34 / 0.1);
		--rn-new-border: rgb(99 153 34 / 0.35);
		--rn-code-fg: #7ee787;
		--rn-code-kind: #79c0ff;
		--rn-code-new: #56d364;
		--rn-tab-active: #58a6ff;
		--rn-scroll-track: #161b22;
		--rn-scroll-thumb: #484f58;
		--rn-selected-bg: #21262d;
		--rn-latest-bg: #1a3a1a;
		--rn-latest-text: #56d364;
		--rn-btn-primary: #1f6feb;
		--rn-timeline-dot-ring: #0d1117;
		--rn-prose: #e6edf3;
		--rn-migration: #c9d1d9;
		--rn-copy-border: #484f58;
		--rn-copy-text: #b1bac4;
		--rn-skeleton-sub: #6e7681;
		--rn-risk-high-bg: rgb(226 75 74 / 0.15);
		--rn-risk-high-fg: #ff7b72;
		--rn-risk-medium-bg: rgb(239 159 39 / 0.15);
		--rn-risk-medium-fg: #ffa657;
		--rn-risk-low-bg: rgb(99 153 34 / 0.15);
		--rn-risk-low-fg: #7ee787;
	}

	.rn-shell {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.rn-sidebar {
		width: 220px;
		flex-shrink: 0;
		border-right: 1px solid var(--rn-border);
		display: flex;
		flex-direction: column;
		background: var(--rn-bg);
	}

	.rn-sidebar-header {
		padding: 16px 14px 10px;
		border-bottom: 1px solid var(--rn-border);
	}

	.rn-sidebar-kicker {
		font-size: 10px;
		color: var(--rn-accent);
		text-transform: uppercase;
		letter-spacing: 1.5px;
		margin-bottom: 4px;
	}

	.rn-sidebar-title {
		font-size: 15px;
		font-weight: 600;
	}

	.rn-sidebar-body {
		padding: 10px 10px 0;
		flex: 1;
		overflow-y: auto;
	}

	.rn-inject {
		margin-bottom: 20px;
	}

	.rn-inject-toggle {
		width: 100%;
		background: var(--rn-bg-elevated);
		border: 1px dashed var(--rn-border-muted);
		border-radius: 8px;
		padding: 10px 16px;
		color: var(--rn-accent);
		cursor: pointer;
		font-size: 13px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.rn-inject-plus {
		font-size: 18px;
		line-height: 1;
	}

	.rn-inject-panel {
		background: var(--rn-bg-elevated);
		border: 1px solid var(--rn-border-muted);
		border-radius: 8px;
		padding: 16px;
		margin-top: 8px;
	}

	.rn-inject-hint,
	.rn-inject-note {
		font-size: 11px;
		color: var(--rn-text-muted);
	}

	.rn-inject-hint {
		font-size: 12px;
		margin-bottom: 8px;
	}

	.rn-inject-note {
		margin-top: 8px;
	}

	.rn-inject-row {
		display: flex;
		gap: 8px;
	}

	.rn-inject-input {
		flex: 1;
		background: var(--rn-bg);
		border: 1px solid var(--rn-border-muted);
		border-radius: 6px;
		padding: 6px 10px;
		color: var(--rn-text);
		font-size: 13px;
	}

	.rn-inject-btn {
		background: var(--rn-btn-primary);
		border: none;
		border-radius: 6px;
		padding: 6px 14px;
		color: #fff;
		cursor: pointer;
		font-size: 13px;
	}

	.rn-loading-msg {
		color: var(--rn-text-muted);
		font-size: 12px;
		text-align: center;
		padding: 8px 0;
		animation: rn-pulse 1.5s infinite;
	}

	.rn-timeline {
		position: relative;
	}

	.rn-timeline-line {
		position: absolute;
		left: 13px;
		top: 8px;
		bottom: 8px;
		width: 1px;
		background: var(--rn-border);
	}

	.rn-timeline-item {
		position: relative;
		width: 100%;
		text-align: left;
		padding: 8px 10px 8px 26px;
		cursor: pointer;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		margin-bottom: 4px;
		color: inherit;
	}

	.rn-timeline-item--selected {
		background: var(--rn-selected-bg);
		border-color: var(--rn-border-muted);
	}

	.rn-timeline-dot {
		position: absolute;
		left: 8px;
		top: 50%;
		transform: translateY(-50%);
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid var(--rn-timeline-dot-ring);
	}

	.rn-timeline-dot--skeleton {
		background: var(--rn-border-muted);
		animation: rn-pulse 1.5s infinite;
	}

	.rn-timeline-version {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--rn-text-subtle);
	}

	.rn-timeline-version--active {
		font-weight: 600;
		color: var(--rn-text);
	}

	.rn-timeline-meta {
		font-size: 11px;
		color: var(--rn-text-muted);
		margin-top: 2px;
	}

	.rn-timeline-breaking {
		font-size: 10px;
		color: #e24b4a;
		margin-top: 2px;
	}

	.rn-timeline-skeleton {
		position: relative;
		padding: 8px 10px 8px 26px;
		margin-bottom: 4px;
		opacity: 0.4;
	}

	.rn-skeleton-text {
		font-size: 13px;
		color: var(--rn-text-muted);
	}

	.rn-skeleton-sub {
		font-size: 11px;
		color: var(--rn-skeleton-sub);
		margin-top: 2px;
	}

	.rn-tag {
		font-size: 9px;
		padding: 1px 5px;
		border-radius: 3px;
	}

	.rn-tag--new {
		background: var(--rn-btn-primary);
		color: #fff;
	}

	.rn-tag--latest {
		background: var(--rn-latest-bg);
		color: var(--rn-latest-text);
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.rn-source-badge {
		margin-left: 4px;
		font-size: 9px;
		color: var(--rn-text-muted);
		border: 1px solid var(--rn-border-muted);
		padding: 0 4px;
		border-radius: 3px;
	}

	.rn-main {
		flex: 1;
		overflow-y: auto;
		background: var(--rn-bg);
	}

	.rn-main-inner {
		padding: 24px 28px;
	}

	.rn-main-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 12px;
		color: var(--rn-text-muted);
		min-height: 300px;
	}

	.rn-main-empty-icon {
		font-size: 32px;
		animation: rn-pulse 1.5s infinite;
	}

	.rn-breaking-banner {
		background: var(--rn-breaking-bg);
		border: 1px solid var(--rn-breaking-border);
		border-radius: 8px;
		padding: 10px 16px;
		margin-bottom: 20px;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.rn-breaking-icon {
		color: #e24b4a;
		font-size: 20px;
	}

	.rn-breaking-sub {
		color: var(--rn-text-subtle);
		font-size: 13px;
		margin-left: 8px;
		font-weight: normal;
	}

	.rn-header-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
		flex-wrap: wrap;
	}

	.rn-header h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 700;
	}

	.rn-header-sub {
		font-size: 13px;
		color: var(--rn-text-muted);
		margin: 0;
	}

	.rn-risk-badge {
		font-size: 11px;
		font-weight: 500;
		padding: 2px 7px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.rn-risk-badge--lg {
		font-size: 13px;
	}

	.rn-risk-badge--high {
		background: var(--rn-risk-high-bg);
		color: var(--rn-risk-high-fg);
	}

	.rn-risk-badge--medium {
		background: var(--rn-risk-medium-bg);
		color: var(--rn-risk-medium-fg);
	}

	.rn-risk-badge--low {
		background: var(--rn-risk-low-bg);
		color: var(--rn-risk-low-fg);
	}

	.rn-tabs {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--rn-border-muted);
		margin-bottom: 20px;
		overflow-x: auto;
	}

	.rn-tab {
		padding: 8px 14px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--rn-text-muted);
		cursor: pointer;
		font-size: 13px;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.rn-tab--active {
		border-bottom-color: var(--rn-tab-active);
		color: var(--rn-tab-active);
	}

	.rn-tab-icon {
		font-size: 10px;
	}

	.rn-tab-badge {
		background: #e24b4a;
		color: #fff;
		border-radius: 50%;
		width: 16px;
		height: 16px;
		font-size: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.rn-card {
		background: var(--rn-bg-elevated);
		border-radius: 8px;
		padding: 16px;
		margin-bottom: 14px;
	}

	.rn-card--accent {
		border-left: 3px solid #ef9f27;
	}

	.rn-card-label {
		font-size: 13px;
		color: var(--rn-text-muted);
		margin-bottom: 6px;
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}

	.rn-prose {
		color: var(--rn-prose);
		line-height: 1.7;
		margin: 0;
	}

	.rn-prose--sm {
		font-size: 14px;
	}

	.rn-stats {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		margin: 14px 0;
	}

	.rn-stat {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.rn-stat-value {
		font-size: 22px;
		font-weight: 600;
	}

	.rn-stat-label {
		font-size: 12px;
		color: var(--rn-text-muted);
		line-height: 1.2;
	}

	.rn-checklist-item {
		display: flex;
		gap: 10px;
		margin-bottom: 8px;
		align-items: flex-start;
		font-size: 14px;
		line-height: 1.5;
	}

	.rn-checklist-num {
		color: var(--rn-accent);
		font-family: monospace;
		font-size: 12px;
		min-width: 20px;
	}

	.rn-empty {
		color: var(--rn-text-muted);
		padding: 32px 0;
		text-align: center;
	}

	.rn-breaking-card {
		background: var(--rn-breaking-bg);
		border: 1px solid var(--rn-breaking-border);
		border-radius: 8px;
		padding: 16px;
		margin-bottom: 14px;
		line-height: 1.6;
	}

	.rn-breaking-card-head {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}

	.rn-pill {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 4px;
		text-transform: uppercase;
		line-height: 1.3;
	}

	.rn-pill--breaking {
		background: rgb(226 75 74 / 0.13);
		color: var(--rn-danger-fg);
	}

	.rn-pill--critical {
		background: rgb(226 75 74 / 0.2);
		color: var(--rn-danger-fg);
	}

	.rn-pill--warning {
		background: rgb(239 159 39 / 0.15);
		color: var(--rn-warning-fg);
	}

	.rn-pill--modified {
		background: rgb(239 159 39 / 0.13);
		color: var(--rn-warning-fg);
	}

	.rn-pill--new {
		background: rgb(99 153 34 / 0.13);
		color: var(--rn-success-fg);
	}

	.rn-code-kind {
		color: var(--rn-code-kind);
		font-size: 15px;
		font-weight: 600;
		word-break: break-word;
	}

	.rn-code-field {
		color: var(--rn-text-muted);
		font-size: 14px;
		word-break: break-word;
	}

	.rn-code-new {
		color: var(--rn-code-new);
		font-size: 14px;
		font-weight: 600;
	}

	.rn-code-warn {
		color: var(--rn-warning-fg);
		font-size: 12px;
	}

	.rn-migration {
		margin-bottom: 12px;
	}

	.rn-migration-step {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--rn-migration);
	}

	.rn-migration-num {
		color: var(--rn-danger-fg);
		font-family: monospace;
		font-size: 13px;
		min-width: 18px;
		flex-shrink: 0;
	}

	.rn-yaml-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	@media (max-width: 768px) {
		.rn-yaml-grid {
			grid-template-columns: 1fr;
		}
	}

	.rn-yaml-label {
		font-size: 13px;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.rn-yaml-label--before {
		color: var(--rn-danger-fg);
	}

	.rn-yaml-label--after {
		color: var(--rn-success-fg);
	}

	.rn-codeblock {
		position: relative;
		background: var(--rn-bg-code);
		border: 1px solid var(--rn-border);
		border-radius: 6px;
		padding: 12px;
		margin-top: 8px;
		overflow-x: auto;
	}

	.rn-codeblock pre {
		margin: 0;
		font-size: 13px;
		color: var(--rn-code-fg);
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.6;
	}

	.rn-copy {
		position: absolute;
		top: 6px;
		right: 8px;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 4px;
		border: 0.5px solid var(--rn-copy-border);
		background: transparent;
		color: var(--rn-copy-text);
		cursor: pointer;
	}

	.rn-pill--deprec {
		background: rgb(239 159 39 / 0.13);
		color: var(--rn-warning-fg);
	}

	.rn-deprec-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--rn-bg);
		padding: 8px 0 12px;
	}

	.rn-deprec-summary {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.rn-deprec-summary-text {
		font-size: 13px;
		color: var(--rn-text-muted);
	}

	.rn-deprec-summary-text strong {
		color: var(--rn-warning-fg);
		font-weight: 600;
	}

	.rn-deprec-search {
		flex: 1;
		min-width: 220px;
		max-width: 360px;
		background: var(--rn-bg);
		border: 1px solid var(--rn-border-muted);
		border-radius: 6px;
		padding: 10px 14px;
		color: var(--rn-text);
		font-size: 14px;
		line-height: 1.4;
	}

	.rn-list-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--rn-bg);
		padding: 8px 0 12px;
	}

	.rn-list-summary {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.rn-list-summary-text {
		font-size: 13px;
		color: var(--rn-text-muted);
	}

	.rn-list-search {
		flex: 1;
		min-width: 220px;
		max-width: 400px;
		background: var(--rn-bg);
		border: 1px solid var(--rn-border-muted);
		border-radius: 6px;
		padding: 10px 14px;
		color: var(--rn-text);
		font-size: 14px;
		line-height: 1.4;
	}

	.rn-breaking-list,
	.rn-mod-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: min(70vh, 900px);
		overflow-y: auto;
		padding-right: 4px;
	}

	.rn-breaking-group {
		background: var(--rn-breaking-bg);
		border: 1px solid var(--rn-breaking-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.rn-breaking-group-head {
		width: 100%;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 10px;
		min-height: 48px;
		padding: 14px 16px;
		box-sizing: border-box;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--rn-text);
		text-align: left;
	}

	.rn-breaking-group-head code {
		flex: 1;
		min-width: 0;
		color: var(--rn-heading);
		font-size: 15px;
		font-weight: 600;
		word-break: break-word;
		line-height: 1.4;
	}

	.rn-breaking-group-head:hover {
		background: rgb(226 75 74 / 0.06);
	}

	.rn-breaking-group-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-top: 1px solid var(--rn-breaking-border);
		line-height: 1.6;
	}

	.rn-breaking-group-body .rn-breaking-card {
		margin-bottom: 0;
	}

	.rn-deprec-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: min(70vh, 900px);
		overflow-y: auto;
		padding-right: 4px;
	}

	.rn-deprec-card {
		background: var(--rn-deprec-bg);
		border: 1px solid var(--rn-deprec-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.rn-deprec-card-head {
		width: 100%;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 10px;
		min-height: 48px;
		padding: 14px 16px;
		box-sizing: border-box;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--rn-text);
		text-align: left;
	}

	.rn-deprec-card-head:hover {
		background: rgb(239 159 39 / 0.06);
	}

	.rn-deprec-chevron {
		color: var(--rn-text-muted);
		font-size: 14px;
		line-height: 1.4;
		transition: transform 0.15s ease;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.rn-deprec-chevron--open {
		transform: rotate(90deg);
	}

	.rn-deprec-card-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.rn-deprec-kind {
		font-size: 16px;
		font-weight: 600;
		color: var(--rn-heading);
		line-height: 1.4;
		word-break: break-word;
	}

	.rn-deprec-group {
		font-size: 13px;
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
		color: var(--rn-text-muted);
		line-height: 1.5;
		word-break: break-all;
	}

	.rn-deprec-count {
		font-size: 13px;
		color: var(--rn-text-muted);
		flex-shrink: 0;
		line-height: 1.4;
		align-self: flex-start;
	}

	.rn-deprec-card-body {
		padding: 16px 16px 16px 40px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-top: 1px solid var(--rn-deprec-border);
		line-height: 1.6;
	}

	.rn-deprec-label {
		display: block;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--rn-text-muted);
		margin-bottom: 6px;
	}

	.rn-deprec-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.rn-deprec-chip {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		min-width: min(100%, 180px);
		padding: 6px 10px;
		border-radius: 6px;
		border: 1px solid var(--rn-deprec-border);
		background: var(--rn-bg-elevated);
		font-size: 13px;
		line-height: 1.4;
	}

	.rn-deprec-chip--new {
		border-color: rgb(239 159 39 / 0.55);
	}

	.rn-deprec-chip-key {
		color: var(--rn-text-muted);
	}

	.rn-deprec-chip-val {
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
		font-size: 13px;
		color: var(--rn-warning-fg);
		background: transparent;
		padding: 0;
		word-break: break-all;
	}

	.rn-deprec-chip-tag {
		font-size: 11px;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--rn-warning-fg);
		background: rgb(239 159 39 / 0.15);
		padding: 2px 6px;
		border-radius: 3px;
	}

	.rn-deprec-row {
		font-size: 14px;
		line-height: 1.6;
	}

	.rn-deprec-recommended {
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
		font-size: 13px;
		color: var(--rn-success-fg);
		background: transparent;
		word-break: break-all;
	}

	.rn-deprec-removed {
		color: var(--rn-text);
		font-size: 14px;
		line-height: 1.6;
	}

	.rn-deprec-migration {
		margin: 0;
		font-size: 14px;
		line-height: 1.6;
		color: var(--rn-migration);
	}

	.rn-new-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	@media (max-width: 768px) {
		.rn-new-grid {
			grid-template-columns: 1fr;
		}
	}

	.rn-new-card {
		background: var(--rn-new-bg);
		border: 1px solid var(--rn-new-border);
		border-radius: 8px;
		padding: 14px;
	}

	.rn-new-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.rn-api-version {
		color: var(--rn-text-muted);
		font-size: 13px;
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
		margin-bottom: 8px;
		line-height: 1.5;
	}

	.rn-mod-group {
		margin-bottom: 0;
		background: var(--rn-bg-elevated);
		border: 1px solid var(--rn-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.rn-mod-head {
		font-size: 15px;
		font-weight: 600;
		color: var(--rn-heading);
		margin-bottom: 8px;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 10px;
	}

	.rn-mod-head--btn {
		width: 100%;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 10px;
		min-height: 48px;
		padding: 14px 16px;
		box-sizing: border-box;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--rn-text);
		text-align: left;
		margin-bottom: 0;
	}

	.rn-mod-head--btn code {
		flex: 1;
		min-width: 0;
		color: var(--rn-heading);
		font-size: 15px;
		font-weight: 600;
		word-break: break-word;
		line-height: 1.4;
	}

	.rn-mod-head--btn:hover {
		background: rgb(37 99 235 / 0.04);
	}

	.rn-mod-table-wrap {
		overflow-x: auto;
		border-top: 1px solid var(--rn-border);
	}

	.rn-mod-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.rn-mod-table th,
	.rn-mod-table td {
		padding: 10px 12px;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--rn-border);
		line-height: 1.6;
	}

	.rn-mod-table th {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--rn-text-subtle);
		background: var(--rn-bg-surface);
	}

	.rn-mod-table code {
		font-size: 13px;
		word-break: break-all;
		color: var(--rn-text);
	}

	.rn-mod-impact {
		color: var(--rn-text-muted);
		line-height: 1.6;
		max-width: 320px;
	}

	.rn-mod-change {
		background: var(--rn-bg-elevated);
		border-radius: 6px;
		padding: 10px 12px;
		margin-bottom: 6px;
		border-left: 3px solid #888;
	}

	.rn-mod-change-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
		flex-wrap: wrap;
	}

	.rn-mod-before-after {
		display: flex;
		gap: 12px;
		margin-bottom: 6px;
		font-size: 12px;
		color: var(--rn-text-muted);
		flex-wrap: wrap;
	}

	.rn-val-before {
		color: var(--rn-danger-fg);
	}

	.rn-val-after {
		color: var(--rn-success-fg);
	}

	.rn-muted {
		color: var(--rn-text-muted);
		font-size: 13px;
		line-height: 1.5;
	}

	.rn-risk-hero {
		display: flex;
		align-items: center;
		gap: 16px;
		background: var(--rn-bg-elevated);
		border-radius: 10px;
		padding: 20px;
		margin-bottom: 16px;
	}

	.rn-risk-icon {
		font-size: 48px;
		line-height: 1;
	}

	.rn-risk-title {
		font-size: 28px;
		font-weight: 700;
		text-transform: uppercase;
	}

	.rn-effort {
		font-size: 16px;
		font-weight: 500;
	}

	.rn-toast {
		position: fixed;
		bottom: 24px;
		right: 24px;
		background: var(--rn-btn-primary);
		color: #fff;
		padding: 10px 18px;
		border-radius: 8px;
		font-size: 13px;
		z-index: 999;
		box-shadow: 0 4px 20px rgb(0 0 0 / 0.25);
		animation: rn-slide-up 0.3s ease;
	}

	@keyframes rn-slide-up {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes rn-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.rn-sidebar-body::-webkit-scrollbar,
	.rn-main::-webkit-scrollbar {
		width: 6px;
	}

	.rn-sidebar-body::-webkit-scrollbar-track,
	.rn-main::-webkit-scrollbar-track {
		background: var(--rn-scroll-track);
	}

	.rn-sidebar-body::-webkit-scrollbar-thumb,
	.rn-main::-webkit-scrollbar-thumb {
		background: var(--rn-scroll-thumb);
		border-radius: 3px;
	}
</style>
