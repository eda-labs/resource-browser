<script lang="ts">
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ComparisonHeader from '$lib/comparison/components/ComparisonHeader.svelte';
	import ReleaseSelectorCard from '$lib/comparison/components/ReleaseSelectorCard.svelte';
	import ComparisonResults from '$lib/comparison/components/ComparisonResults.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import { compareHint, matchesSearch } from '$lib/comparison/comparisonUtils';
	import {
		generateBulkDiffReport,
		loadCrdsForRelease,
		loadVersionsForRelease
	} from '$lib/comparison/diffEngine';
	import { resourceLinkContext } from '$lib/comparison/links';
	import type { BulkDiffReport, CrdDiffEntry, DiffStatus } from '$lib/comparison/types';
	import { getManifestCache } from '$lib/manifest';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

	let sourceReleaseName = '';
	let sourceVersion = '';
	let targetReleaseName = '';
	let targetVersion = '';
	let sourceRelease: EdaRelease | null = null;
	let targetRelease: EdaRelease | null = null;
	let sourceVersions: string[] = [];
	let targetVersions: string[] = [];
	let sourceVersionsLoading = false;
	let targetVersionsLoading = false;

	let progress = 0;
	let progressCurrent = 0;
	let progressTotal = 0;
	let generating = false;
	let report: BulkDiffReport | null = null;
	let compareError = '';
	let statusFilter: DiffStatus[] = ['added', 'removed', 'modified'];
	let expandedCrdNames: string[] = [];
	let searchQuery = '';
	let searchRegex = true;
	let debouncedSearch = '';
	let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
	let clientReady = false;
	let swapping = false;

	let modalOpen = false;
	let modalResource: CrdResource | null = null;
	let modalRelease: EdaRelease | null = null;
	let modalVersion: string | null = null;

	const manifestCache = getManifestCache();
	const yamlCache: Map<string, string> = new Map();

	$: sourceRelease = sourceReleaseName
		? releasesConfig.releases.find((r) => r.name === sourceReleaseName) || null
		: null;
	$: targetRelease = targetReleaseName
		? releasesConfig.releases.find((r) => r.name === targetReleaseName) || null
		: null;

	$: activeStep = report ? 3 : generating ? 2 : 1;
	$: effectiveSearch = searchRegex ? debouncedSearch : searchQuery;

	$: versionFilter =
		sourceVersion && targetVersion && sourceVersion === targetVersion ? sourceVersion : undefined;

	$: canCompare =
		!!sourceRelease &&
		!!targetRelease &&
		!generating &&
		sourceReleaseName !== targetReleaseName;

	$: hintText = compareHint(
		canCompare,
		generating,
		sourceVersionsLoading,
		targetVersionsLoading,
		sourceRelease?.label,
		sourceVersion,
		targetRelease?.label,
		targetVersion
	);

	function updateURL() {
		if (!browser) return;
		const params = new URLSearchParams();
		if (sourceReleaseName) params.set('sr', sourceReleaseName);
		if (sourceVersion) params.set('sv', sourceVersion);
		if (targetReleaseName) params.set('tr', targetReleaseName);
		if (targetVersion) params.set('tv', targetVersion);
		const targetUrl = `/comparison${params.toString() ? `?${params.toString()}` : ''}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function pickDefaultVersion(versions: string[], preferred?: string): string {
		if (preferred && versions.includes(preferred)) return preferred;
		return versions.length > 0 ? versions[versions.length - 1] : '';
	}

	function resolveRelease(name: string): EdaRelease | null {
		return releasesConfig.releases.find((r) => r.name === name) ?? null;
	}

	async function loadSourceVersions(preferred?: string) {
		const release = sourceReleaseName ? resolveRelease(sourceReleaseName) : null;
		if (!browser || !release) {
			sourceVersions = [];
			sourceVersion = '';
			return;
		}
		sourceVersionsLoading = true;
		try {
			sourceVersions = await loadVersionsForRelease(release, manifestCache);
			sourceVersion = pickDefaultVersion(sourceVersions, preferred ?? sourceVersion);
		} catch {
			sourceVersions = [];
			sourceVersion = '';
		} finally {
			sourceVersionsLoading = false;
			if (clientReady) updateURL();
		}
	}

	async function loadTargetVersions(preferred?: string) {
		const release = targetReleaseName ? resolveRelease(targetReleaseName) : null;
		if (!browser || !release) {
			targetVersions = [];
			targetVersion = '';
			return;
		}
		targetVersionsLoading = true;
		try {
			targetVersions = await loadVersionsForRelease(release, manifestCache);
			targetVersion = pickDefaultVersion(targetVersions, preferred ?? targetVersion);
		} catch {
			targetVersions = [];
			targetVersion = '';
		} finally {
			targetVersionsLoading = false;
			if (clientReady) updateURL();
		}
	}

	let previousSourceRelease = '';
	$: if (browser && clientReady && sourceReleaseName !== previousSourceRelease) {
		previousSourceRelease = sourceReleaseName;
		void loadSourceVersions();
	}

	let previousTargetRelease = '';
	$: if (browser && clientReady && targetReleaseName !== previousTargetRelease) {
		previousTargetRelease = targetReleaseName;
		void loadTargetVersions();
	}

	function handleSearchInput() {
		if (debounceTimeout) clearTimeout(debounceTimeout);
		if (!searchRegex) {
			debouncedSearch = searchQuery;
		} else {
			debounceTimeout = setTimeout(() => {
				debouncedSearch = searchQuery;
			}, 250);
		}
	}

	$: if (!searchRegex) {
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			debounceTimeout = null;
		}
		debouncedSearch = searchQuery;
	}

	function toggleStatusFilter(status: DiffStatus) {
		if (statusFilter.includes(status)) {
			statusFilter = statusFilter.filter((s) => s !== status);
		} else {
			statusFilter = [...statusFilter, status];
		}
	}

	function toggleCrdExpand(name: string, version: string) {
		const key = `${name}:${version}`;
		expandedCrdNames = expandedCrdNames.includes(key)
			? expandedCrdNames.filter((n) => n !== key)
			: [...expandedCrdNames, key];
	}

	function swapReleases() {
		swapping = true;
		const prevSourceName = sourceReleaseName;
		const prevSourceVersion = sourceVersion;
		const prevTargetName = targetReleaseName;
		const prevTargetVersion = targetVersion;

		sourceReleaseName = prevTargetName;
		sourceVersion = prevTargetVersion;
		targetReleaseName = prevSourceName;
		targetVersion = prevSourceVersion;
		report = null;
		compareError = '';
		updateURL();
		setTimeout(() => {
			swapping = false;
		}, 320);
	}

	async function runComparison() {
		if (!browser || !sourceRelease || !targetRelease) {
			compareError = 'Select source and target releases.';
			return;
		}
		if (sourceReleaseName === targetReleaseName) {
			compareError = 'Source and target releases must differ.';
			return;
		}

		generating = true;
		progress = 0;
		progressCurrent = 0;
		progressTotal = 0;
		compareError = '';
		report = null;
		expandedCrdNames = [];

		try {
			progressTotal = 0;
			report = await generateBulkDiffReport({
				sourceRelease,
				targetRelease,
				versionFilter,
				manifestCache,
				yamlCache,
				onProgress: (pct, current, total) => {
					progress = pct;
					progressCurrent = current;
					progressTotal = total;
				}
			});
			updateURL();
		} catch (e) {
			compareError = e instanceof Error ? e.message : 'Comparison failed.';
		} finally {
			generating = false;
		}
	}

	async function openCrdModal(crd: CrdDiffEntry) {
		const ctx = resourceLinkContext(crd, sourceReleaseName, targetReleaseName);
		if (!ctx) return;

		const release = releasesConfig.releases.find((r) => r.name === ctx.releaseName);
		if (!release) return;

		const crds = await loadCrdsForRelease(release, manifestCache);
		const resource = crds.find((r) => r.name === crd.name);
		if (!resource) return;

		modalResource = resource;
		modalRelease = release;
		modalVersion = ctx.version;
		modalOpen = true;
	}

	function closeCrdModal() {
		modalOpen = false;
		modalResource = null;
		modalRelease = null;
		modalVersion = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
		if (!canCompare) return;
		e.preventDefault();
		void runComparison();
	}

	onMount(async () => {
		const urlSr = $page.url.searchParams.get('sr');
		const urlSv = $page.url.searchParams.get('sv');
		const urlTr = $page.url.searchParams.get('tr');
		const urlTv = $page.url.searchParams.get('tv');

		const defaultRelease =
			releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
		const fallbackTarget =
			releasesConfig.releases.find((r) => r.name !== defaultRelease?.name) ||
			releasesConfig.releases[1];

		sourceReleaseName = urlSr || defaultRelease?.name || '';
		targetReleaseName = urlTr || fallbackTarget?.name || '';

		if (urlSv) sourceVersion = urlSv;
		if (urlTv) targetVersion = urlTv;

		previousSourceRelease = sourceReleaseName;
		previousTargetRelease = targetReleaseName;

		await Promise.all([
			loadSourceVersions(urlSv || undefined),
			loadTargetVersions(urlTv || undefined)
		]);

		clientReady = true;

		if (urlSr && urlSv && urlTr && urlTv) {
			await runComparison();
		}
	});
</script>

<svelte:head>
	<title>EDA Resource Browser | Release Comparison</title>
	<meta
		name="description"
		content="Compare Nokia EDA CRD schemas between two releases — find added, removed, and modified resources."
	/>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="spec-search-main">
		<ComparisonHeader activeStep={activeStep as 1 | 2 | 3} />

		<div class="spec-search-results-panel comparison-selector-panel">
			<div class="comparison-selector-panel__header">
				<h2 class="comparison-selector-panel__title">Release selectors</h2>
				<p class="comparison-selector-panel__subtitle">
					Source is the baseline; target is compared against it.
				</p>
			</div>

			<div class="comparison-selector-panel__body">
				<div class="comparison-selector-layout">
					<ReleaseSelectorCard
						role="source"
						bind:releaseName={sourceReleaseName}
						bind:version={sourceVersion}
						release={sourceRelease}
						releases={releasesConfig.releases}
						versions={sourceVersions}
						versionsLoading={sourceVersionsLoading}
						{swapping}
						onReleaseChange={() => {
							report = null;
							updateURL();
						}}
						onVersionChange={updateURL}
					/>

					<div class="comparison-swap-wrap">
						<button
							type="button"
							on:click={swapReleases}
							disabled={!sourceReleaseName && !targetReleaseName}
							class="comparison-swap-btn"
							class:comparison-swap-btn--active={swapping}
							aria-label="Swap source and target releases"
							title="Swap source and target"
						>
							<svg class="comparison-swap-btn__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
							</svg>
							<span class="comparison-swap-btn__label">Swap</span>
						</button>
					</div>

					<ReleaseSelectorCard
						role="target"
						bind:releaseName={targetReleaseName}
						bind:version={targetVersion}
						release={targetRelease}
						releases={releasesConfig.releases}
						versions={targetVersions}
						versionsLoading={targetVersionsLoading}
						{swapping}
						onReleaseChange={() => {
							report = null;
							updateURL();
						}}
						onVersionChange={updateURL}
					/>
				</div>

				<div class="comparison-action-bar">
					<div class="comparison-action-bar__status">
						{#if compareError}
							<p class="comparison-action-bar__error" role="alert">{compareError}</p>
						{:else}
							<p class="comparison-action-bar__hint">{hintText}</p>
						{/if}
					</div>

					<button
						type="button"
						on:click={runComparison}
						disabled={!canCompare}
						aria-busy={generating}
						title={canCompare ? 'Compare releases (Enter)' : hintText}
						class="comparison-compare-btn"
					>
						{#if generating}
							<svg class="comparison-compare-btn__spinner" fill="none" viewBox="0 0 24 24" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
							</svg>
							<span>
								Comparing {progressCurrent} of {progressTotal || '…'}
								<span class="comparison-compare-btn__pct">({progress}%)</span>
							</span>
						{:else}
							Compare releases
						{/if}
					</button>
				</div>

				{#if generating}
					<div
						class="comparison-progress"
						role="progressbar"
						aria-valuenow={progress}
						aria-valuemin="0"
						aria-valuemax="100"
						aria-label="Comparison progress"
					>
						<div class="comparison-progress__bar" style="width: {progress}%"></div>
					</div>
				{/if}
			</div>
		</div>

		{#if report}
			<ComparisonResults
				{report}
				{sourceReleaseName}
				{targetReleaseName}
				{sourceVersion}
				{targetVersion}
				bind:statusFilter
				bind:expandedCrdNames
				bind:searchQuery
				bind:searchRegex
				{effectiveSearch}
				onToggleStatusFilter={toggleStatusFilter}
				onToggleCrdExpand={toggleCrdExpand}
				onExpandAll={() => {
					expandedCrdNames = report!.crds
						.filter(
							(c) =>
								statusFilter.includes(c.status) &&
								!c.name.includes('states') &&
								matchesSearch(c, effectiveSearch, searchRegex)
						)
						.map((c) => `${c.name}:${c.version}`);
				}}
				onCollapseAll={() => {
					expandedCrdNames = [];
				}}
				onSearchInput={handleSearchInput}
				onClearSearch={() => {
					searchQuery = '';
					debouncedSearch = '';
					if (debounceTimeout) clearTimeout(debounceTimeout);
				}}
				onToggleSearchRegex={() => {
					searchRegex = !searchRegex;
				}}
				onViewCrd={openCrdModal}
			/>
		{:else if generating}
			<div class="spec-search-results-panel">
				<div class="comparison-loading">
					{#each Array(5) as _, i}
						<div class="comparison-skeleton comparison-skeleton--row" style="animation-delay: {i * 80}ms"></div>
					{/each}
				</div>
			</div>
		{:else if clientReady}
			<div class="spec-search-results-panel">
				<div class="spec-search-empty">
					<div class="spec-search-empty-icon">
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
						</svg>
					</div>
					<h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">No report yet</h3>
					<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
						Choose source and target releases, then click Compare releases to generate a schema diff.
					</p>
				</div>
			</div>
		{/if}

		<PageCredits />
	</div>
</div>

{#if modalRelease}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={modalRelease}
		allReleases={releasesConfig.releases}
		initialVersion={modalVersion}
		onClose={closeCrdModal}
	/>
{/if}
