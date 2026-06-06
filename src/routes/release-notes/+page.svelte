<script lang="ts">
	import yaml from 'js-yaml';
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import { sortReleasesByVersion } from '$lib/release-notes/generateNotes';
	import {
		CHANGE_COLORS,
		HIGH_RISK_CHANGE_TYPES,
		RISK_COLOR,
		TAB_ICONS,
		TABS
	} from '$lib/release-notes/constants';
	import {
		fetchAllReleaseNotes,
		fetchReleaseNotesEntry,
		fetchReleaseNotesIndex
	} from '$lib/release-notes/loadStatic';
	import type { ReleaseNotes, ReleaseNotesEntry } from '$lib/release-notes/types';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { ReleasesConfig } from '$lib/structure';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

	let releaseHistory: ReleaseNotesEntry[] = $state([]);
	let selected: string | null = $state(null);
	let toast: string | null = $state(null);
	let globalLoading = $state(true);
	let loadingMsg = $state('Loading release notes...');
	let activeTab = $state(0);
	let injectOpen = $state(false);
	let injectVersion = $state('');
	let copiedCode: string | null = $state(null);

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

		const breakingCount = entry.notes.breakingChanges.length;
		showToast(
			`Release ${version} loaded (${entry.source}) — ${breakingCount} breaking change${breakingCount !== 1 ? 's' : ''}`
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
			{ label: 'Breaking', value: notes.breakingChanges.length, color: '#e24b4a' },
			{ label: 'Deprecated', value: notes.deprecated.length, color: '#ef9f27' }
		];
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
							{#if entry.notes.breakingChanges.length > 0}
								<div class="rn-timeline-breaking">
									⚠ {entry.notes.breakingChanges.length} breaking
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
					{#if selectedEntry.notes.breakingChanges.length > 0}
						<div class="rn-breaking-banner" role="alert">
							<span class="rn-breaking-icon">⚠</span>
							<div>
								<strong
									>{selectedEntry.notes.breakingChanges.length} breaking change{selectedEntry.notes
										.breakingChanges.length !== 1
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
								(i === 1 && selectedEntry.notes.breakingChanges.length > 0) ||
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
											? selectedEntry.notes.breakingChanges.length
											: selectedEntry.notes.deprecated.length}
									</span>
								{/if}
							</button>
						{/each}
					</div>

					<!-- Tab panels -->
					<div class="rn-tab-panel" role="tabpanel">
						{#if activeTab === 0}
							<div class="rn-card">
								<div class="rn-card-label">Executive Summary</div>
								<p class="rn-prose">{selectedEntry.notes.summary}</p>
							</div>
							<div class="rn-stats">
								{#each statItems(selectedEntry.notes) as stat (stat.label)}
									<div class="rn-stat">
										<span class="rn-stat-value" style:color={stat.color}>{stat.value}</span>
										<span class="rn-stat-label">{stat.label}</span>
									</div>
								{/each}
							</div>
							{#if selectedEntry.notes.operationalImpact}
								<div class="rn-card rn-card--accent">
									<div class="rn-card-label">Operational Impact</div>
									<p class="rn-prose rn-prose--sm">{selectedEntry.notes.operationalImpact}</p>
								</div>
							{/if}
							{#if selectedEntry.notes.upgradeChecklist.length > 0}
								<div class="rn-checklist">
									<div class="rn-card-label">Pre-upgrade checklist</div>
									{#each selectedEntry.notes.upgradeChecklist as step, i (step)}
										<div class="rn-checklist-item">
											<span class="rn-checklist-num">{String(i + 1).padStart(2, '0')}</span>
											<span>{step}</span>
										</div>
									{/each}
								</div>
							{/if}
						{:else if activeTab === 1}
							{#if selectedEntry.notes.breakingChanges.length === 0}
								<div class="rn-empty">No breaking changes in this release ✓</div>
							{:else}
								{#each selectedEntry.notes.breakingChanges as b, i (i)}
									<div class="rn-breaking-card">
										<div class="rn-breaking-card-head">
											<span class="rn-pill rn-pill--breaking">BREAKING</span>
											<code class="rn-code-kind">{b.kind}</code>
											<code class="rn-code-field">→ {b.field}</code>
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
							{/if}
						{:else if activeTab === 2}
							{#if selectedEntry.notes.deprecated.length === 0}
								<div class="rn-empty">No deprecations in this release</div>
							{:else}
								<div class="rn-deprec-grid rn-deprec-head">
									<span>Resource</span><span>Field</span><span>Removed in</span><span
										>Migration</span
									>
								</div>
								{#each selectedEntry.notes.deprecated as d, i (i)}
									<div class="rn-deprec-grid rn-deprec-row">
										<code class="rn-code-kind">{d.kind}</code>
										<code class="rn-code-warn">{d.field}</code>
										<span>{d.removedInVersion || 'TBD'}</span>
										<span class="rn-muted">{d.migrationPath}</span>
									</div>
								{/each}
							{/if}
						{:else if activeTab === 3}
							{#if selectedEntry.notes.newResources.length === 0}
								<div class="rn-empty">No new resources in this release</div>
							{:else}
								<div class="rn-new-grid">
									{#each selectedEntry.notes.newResources as r, i (i)}
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
						{:else if activeTab === 4}
							{#if selectedEntry.notes.modifiedResources.length === 0}
								<div class="rn-empty">No field-level modifications in this release</div>
							{:else}
								{#each selectedEntry.notes.modifiedResources as r, i (i)}
									<div class="rn-mod-group">
										<div class="rn-mod-head">
											<span>◈</span>
											<code>{r.kind}</code>
											<span class="rn-muted"
												>{r.changes.length} change{r.changes.length !== 1 ? 's' : ''}</span
											>
										</div>
										{#each r.changes as c, j (j)}
											{@const col = CHANGE_COLORS[c.changeType] ?? '#888'}
											<div class="rn-mod-change" style:border-left-color={col}>
												<div class="rn-mod-change-head">
													<code>{c.field}</code>
													<span class="rn-pill" style:background="{col}22" style:color={col}>
														{c.changeType.replace(/_/g, ' ')}
													</span>
													{#if HIGH_RISK_CHANGE_TYPES.has(c.changeType)}
														<span class="rn-pill rn-pill--breaking">high risk</span>
													{/if}
												</div>
												{#if c.before || c.after}
													<div class="rn-mod-before-after">
														{#if c.before}<span
																>before: <code class="rn-val-before">{c.before}</code></span
															>{/if}
														{#if c.after}<span
																>after: <code class="rn-val-after">{c.after}</code></span
															>{/if}
													</div>
												{/if}
												{#if c.networkBehavior}
													<p class="rn-muted rn-prose--sm">{c.networkBehavior}</p>
												{/if}
											</div>
										{/each}
									</div>
								{/each}
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
							{#if selectedEntry.notes.upgradeChecklist.length > 0}
								<div class="rn-card">
									<div class="rn-card-label">Pre-upgrade steps</div>
									{#each selectedEntry.notes.upgradeChecklist as step, i (step)}
										<div class="rn-checklist-item">
											<span class="rn-checklist-num">{i + 1}</span>
											<span>{step}</span>
										</div>
									{/each}
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
		--rn-text-muted: #64748b;
		--rn-text-subtle: #94a3b8;
		--rn-accent: #2563eb;
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
		--rn-bg-surface: #161b22;
		--rn-bg-code: #0d1117;
		--rn-border: #21262d;
		--rn-border-muted: #30363d;
		--rn-text: #e6edf3;
		--rn-text-muted: #7d8590;
		--rn-text-subtle: #8b949e;
		--rn-accent: #58a6ff;
		--rn-breaking-bg: #1a0a0a;
		--rn-breaking-border: rgb(226 75 74 / 0.53);
		--rn-deprec-bg: #16110a;
		--rn-deprec-border: rgb(239 159 39 / 0.27);
		--rn-new-bg: #0a160a;
		--rn-new-border: rgb(99 153 34 / 0.27);
		--rn-code-fg: #7ee787;
		--rn-code-kind: #79c0ff;
		--rn-code-new: #56d364;
		--rn-tab-active: #58a6ff;
		--rn-scroll-track: #161b22;
		--rn-scroll-thumb: #30363d;
		--rn-selected-bg: #161b22;
		--rn-latest-bg: #1a3a1a;
		--rn-latest-text: #56d364;
		--rn-btn-primary: #1f6feb;
		--rn-timeline-dot-ring: #0d1117;
		--rn-prose: #e6edf3;
		--rn-migration: #c9d1d9;
		--rn-copy-border: #444;
		--rn-copy-text: #aaa;
		--rn-skeleton-sub: #4a4f57;
		--rn-risk-high-bg: rgb(226 75 74 / 0.15);
		--rn-risk-high-fg: #e24b4a;
		--rn-risk-medium-bg: rgb(239 159 39 / 0.15);
		--rn-risk-medium-fg: #ef9f27;
		--rn-risk-low-bg: rgb(99 153 34 / 0.15);
		--rn-risk-low-fg: #639922;
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
		font-size: 12px;
		color: var(--rn-text-muted);
		margin-bottom: 6px;
		text-transform: uppercase;
		letter-spacing: 1px;
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
	}

	.rn-breaking-card-head {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}

	.rn-pill {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		text-transform: uppercase;
	}

	.rn-pill--breaking {
		background: rgb(226 75 74 / 0.13);
		color: #e24b4a;
	}

	.rn-pill--new {
		background: rgb(99 153 34 / 0.13);
		color: #639922;
	}

	.rn-code-kind {
		color: var(--rn-code-kind);
		font-size: 13px;
	}

	.rn-code-field {
		color: var(--rn-text-muted);
		font-size: 13px;
	}

	.rn-code-new {
		color: var(--rn-code-new);
		font-size: 14px;
		font-weight: 600;
	}

	.rn-code-warn {
		color: #ef9f27;
		font-size: 12px;
	}

	.rn-migration {
		margin-bottom: 12px;
	}

	.rn-migration-step {
		display: flex;
		gap: 8px;
		margin-bottom: 6px;
		font-size: 13px;
		color: var(--rn-migration);
	}

	.rn-migration-num {
		color: #e24b4a;
		font-family: monospace;
		font-size: 12px;
		min-width: 16px;
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
		font-size: 11px;
		margin-bottom: 4px;
	}

	.rn-yaml-label--before {
		color: #e24b4a;
	}

	.rn-yaml-label--after {
		color: #639922;
	}

	.rn-codeblock {
		position: relative;
		background: var(--rn-bg-code);
		border: 1px solid var(--rn-border);
		border-radius: 6px;
		padding: 10px 14px;
		margin-top: 8px;
	}

	.rn-codeblock pre {
		margin: 0;
		font-size: 12px;
		color: var(--rn-code-fg);
		font-family: monospace;
		white-space: pre-wrap;
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

	.rn-deprec-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr 1fr;
		gap: 8px;
		align-items: start;
	}

	.rn-deprec-head {
		font-size: 11px;
		color: var(--rn-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.8px;
		padding: 0 8px;
		margin-bottom: 8px;
	}

	.rn-deprec-row {
		background: var(--rn-deprec-bg);
		border: 1px solid var(--rn-deprec-border);
		border-radius: 6px;
		padding: 10px 8px;
		margin-bottom: 8px;
		font-size: 12px;
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
		font-size: 11px;
		font-family: monospace;
		margin-bottom: 8px;
	}

	.rn-mod-group {
		margin-bottom: 16px;
	}

	.rn-mod-head {
		font-size: 14px;
		font-weight: 600;
		color: var(--rn-code-kind);
		margin-bottom: 8px;
		display: flex;
		align-items: center;
		gap: 8px;
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
		color: #e24b4a;
	}

	.rn-val-after {
		color: #639922;
	}

	.rn-muted {
		color: var(--rn-text-muted);
		font-size: 12px;
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
