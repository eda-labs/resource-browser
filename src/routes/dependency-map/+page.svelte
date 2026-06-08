<script lang="ts">
	import { loadStaticYaml } from '$lib/yaml/safeYaml';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import DependencyMapGraph from '$lib/dependency-map/DependencyMapGraph.svelte';
	import {
		buildDependencyGraph,
		buildFocusSubgraph,
		resolveFocusNodeId
	} from '$lib/dependency-map/buildGraph';
	import type { BuildProgress, DependencyGraph, GraphNode } from '$lib/dependency-map/types';
	import { fetchManifest } from '$lib/manifest';
	import { searchResources } from '$lib/resourceSearch';
	import { getLatestVersion } from '$lib/versions';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;
	const workflowSteps = [
		{ num: 1, title: 'Search', desc: 'Find a CRD by kind or name' },
		{ num: 2, title: 'Select', desc: 'Pick the resource to map' },
		{ num: 3, title: 'Explore', desc: 'Transitive dependency subgraph' }
	] as const;

	let releaseName = '';
	let release: EdaRelease | null = null;
	let clientReady = false;

	let manifestResources: CrdResource[] = [];
	let manifestLoading = false;

	let focusResource = '';
	let focusNodeId: string | null = null;
	let subgraph: DependencyGraph | null = null;

	let buildingGraph = false;
	let progress: BuildProgress | null = null;
	let error: string | null = null;
	let buildGeneration = 0;

	let resourceSearch = '';
	let searchFocused = false;
	let highlightedIndex = 0;

	let modalOpen = false;
	let modalResource: CrdResource | null = null;

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	$: activeStep = subgraph ? 3 : buildingGraph || focusNodeId ? 2 : 1;

	$: progressPercent =
		progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

	$: focusKind = focusNodeId
		? manifestResources.find((r) => r.name === focusNodeId)?.kind ??
			subgraph?.nodes.find((n) => n.id === focusNodeId)?.kind ??
			shortName(focusNodeId)
		: '';

	$: focusGroup = focusNodeId
		? manifestResources.find((r) => r.name === focusNodeId)?.group ??
			subgraph?.nodes.find((n) => n.id === focusNodeId)?.group ??
			groupName(focusNodeId)
		: '';

	$: filteredResources = searchResources(manifestResources, resourceSearch);

	$: showSearchResults = searchFocused && resourceSearch.trim().length > 0;

	$: if (filteredResources.length === 0) {
		highlightedIndex = 0;
	} else if (highlightedIndex >= filteredResources.length) {
		highlightedIndex = filteredResources.length - 1;
	}

	function cancelPendingBuild() {
		buildGeneration++;
		buildingGraph = false;
		progress = null;
	}

	function updateURL() {
		if (!browser) return;
		const params = new URLSearchParams();
		if (releaseName) params.set('release', releaseName);
		if (focusResource) params.set('resource', focusResource);
		const targetUrl = `/dependency-map${params.toString() ? `?${params.toString()}` : ''}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
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

	function clearFocus() {
		cancelPendingBuild();
		focusResource = '';
		focusNodeId = null;
		subgraph = null;
		error = null;
		resourceSearch = '';
		searchFocused = false;
		updateURL();
	}

	function handleChangeResource() {
		clearFocus();
		searchFocused = true;
	}

	async function loadManifestForRelease(rel: EdaRelease) {
		manifestLoading = true;
		try {
			const manifest = await fetchManifest(rel.folder);
			manifestResources = manifest ? (manifest as CrdResource[]) : [];
		} catch {
			manifestResources = [];
		} finally {
			manifestLoading = false;
		}
	}

	async function buildSubgraphForFocus(rel: EdaRelease, nodeId: string) {
		const generation = ++buildGeneration;
		buildingGraph = true;
		error = null;
		subgraph = null;
		progress = { phase: 'manifest', current: 0, total: 1, message: 'Starting…' };

		try {
			const fullGraph = await buildDependencyGraph(rel, {
				onProgress: (p) => {
					if (generation === buildGeneration) progress = p;
				}
			});
			if (generation !== buildGeneration) return;

			const result = buildFocusSubgraph(fullGraph, nodeId);
			if (!result) {
				error = `Could not build dependency map for "${focusResource}".`;
				focusNodeId = null;
				return;
			}
			subgraph = result;
		} catch (err) {
			if (generation !== buildGeneration) return;
			error = err instanceof Error ? err.message : String(err);
			focusNodeId = null;
		} finally {
			if (generation === buildGeneration) {
				buildingGraph = false;
			}
		}
	}

	function resolveAndBuildFromUrl(resourceParam: string) {
		if (!release || !resourceParam) return;
		const nodeId = resolveFocusNodeId(manifestResources, { resource: resourceParam });
		if (!nodeId) {
			error = `No CRD matches "${resourceParam}" in ${release.label}.`;
			return;
		}
		focusNodeId = nodeId;
		focusResource = resourceParam;
		void buildSubgraphForFocus(release, nodeId);
	}

	async function selectResource(resource: CrdResource) {
		if (!release) return;
		cancelPendingBuild();
		resourceSearch = '';
		searchFocused = false;
		error = null;
		focusResource = resource.name;
		focusNodeId = resource.name;
		updateURL();
		await buildSubgraphForFocus(release, resource.name);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			searchFocused = false;
			resourceSearch = '';
			return;
		}
		if (!showSearchResults || filteredResources.length === 0) {
			if (event.key === 'Enter' && filteredResources[0]) {
				event.preventDefault();
				void selectResource(filteredResources[0]);
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
			void selectResource(filteredResources[highlightedIndex]);
		}
	}

	function closeSearchResults() {
		if (browser) {
			setTimeout(() => (searchFocused = false), 150);
		}
	}

	function handleReleaseChange() {
		error = null;
		clearFocus();
	}

	function handleViewCrd(node: GraphNode) {
		modalResource = {
			name: node.id,
			kind: node.kind,
			group: node.group,
			versions: [{ name: node.version, deprecated: false, appVersion: '' }]
		};
		modalOpen = true;
	}

	function closeResourceModal() {
		modalOpen = false;
		modalResource = null;
	}

	let previousReleaseName = '';
	$: if (browser && clientReady && releaseName !== previousReleaseName) {
		previousReleaseName = releaseName;
		updateURL();
		if (release) {
			void loadManifestForRelease(release).then(() => {
				const urlResource = $page.url.searchParams.get('resource');
				if (urlResource && !focusNodeId && !buildingGraph) {
					resolveAndBuildFromUrl(urlResource);
				}
			});
		} else {
			manifestResources = [];
		}
	}

	onMount(() => {
		const urlRelease = $page.url.searchParams.get('release');
		if (urlRelease) {
			releaseName = urlRelease;
		} else {
			const defaultRelease =
				releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
			if (defaultRelease) releaseName = defaultRelease.name;
		}
		focusResource = $page.url.searchParams.get('resource') ?? '';
		clientReady = true;
	});


</script>

<svelte:head>
	<title>EDA Resource Browser | CRD Dependency Map</title>
	<meta
		name="description"
		content="Interactive dependency map of Nokia EDA CRDs — explore config, state, and schema-inferred relationships for a release."
	/>
</svelte:head>

<div
	class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100"
	class:dep-map-page--active={!!subgraph}
>
	<AppHeader fixed={false} />

	<div class="spec-search-main">
		<section class="comparison-hero" aria-labelledby="dependency-map-heading">
			<div class="comparison-hero__content">
				<p class="homepage-hero-kicker">Schema relationships</p>
				<h1 id="dependency-map-heading" class="homepage-title text-slate-900 dark:text-slate-100">
					CRD Dependency Map
				</h1>
				<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
					Search for a CRD, then explore its full transitive dependency subgraph — ancestors and
					descendants inferred from release schemas and catalog structure.
				</p>
			</div>

			<ol class="comparison-workflow" aria-label="Dependency map workflow">
				{#each workflowSteps as step}
					<li
						class="comparison-workflow-step"
						class:comparison-workflow-step--active={activeStep === step.num}
						class:comparison-workflow-step--done={activeStep > step.num}
					>
						<span class="comparison-workflow-step__num" aria-hidden="true">{step.num}</span>
						<span class="comparison-workflow-step__text">
							<span class="comparison-workflow-step__title">{step.title}</span>
							<span class="comparison-workflow-step__desc">{step.desc}</span>
						</span>
					</li>
				{/each}
			</ol>
		</section>

		<div class="spec-search-filters" role="group" aria-label="Dependency map options">
			<label for="dependency-map-release" class="sr-only">Release</label>
			<select
				id="dependency-map-release"
				bind:value={releaseName}
				on:change={handleReleaseChange}
				class="spec-search-select min-w-[10rem] flex-1 sm:flex-none"
				aria-label="Select EDA release"
			>
				<option value="">Select release…</option>
				{#each releasesConfig.releases as r}
					<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
				{/each}
			</select>

			{#if subgraph && focusNodeId}
				<button
					type="button"
					class="spec-search-select ml-auto shrink-0 border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-slate-700"
					on:click={handleChangeResource}
				>
					Change resource
				</button>
			{/if}
		</div>

		{#if !subgraph}
			<div class="homepage-search-zone">
				<label for="dep-map-resource-search" class="sr-only">Search CRD resources</label>
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
							id="dep-map-resource-search"
							type="search"
							bind:value={resourceSearch}
							on:focus={() => (searchFocused = true)}
							on:blur={closeSearchResults}
							on:keydown={handleSearchKeydown}
							placeholder={release
								? manifestLoading
									? 'Loading CRD catalog…'
									: `Search ${manifestResources.length || '300+'} CRDs by kind, name, or group…`
								: 'Select a release to start searching…'}
							class="homepage-search-field text-slate-900 placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
							disabled={!release || manifestLoading || buildingGraph}
							autocomplete="off"
							aria-controls="dep-map-search-results"
							aria-autocomplete="list"
						/>
						{#if resourceSearch}
							<button
								type="button"
								aria-label="Clear search"
								on:click|preventDefault|stopPropagation={() => {
									resourceSearch = '';
								}}
								class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						{/if}
					</div>

					{#if showSearchResults}
						<ul
							id="dep-map-search-results"
							role="listbox"
							class="dep-map-search-results"
						>
							{#if filteredResources.length === 0}
								<li class="dep-map-search-empty">
									No resources match “{resourceSearch.trim()}”
								</li>
							{:else}
								<li class="dep-map-search-hint" aria-hidden="true">
									{filteredResources.length} match{filteredResources.length === 1 ? '' : 'es'} — use ↑↓ and Enter
								</li>
								{#each filteredResources as resource, i}
									<li role="option" aria-selected={i === highlightedIndex}>
										<button
											type="button"
											on:mousedown|preventDefault={() => selectResource(resource)}
											class="dep-map-search-row"
											class:dep-map-search-row-active={i === highlightedIndex}
										>
											<div class="dep-map-search-row-main">
												<span class="dep-map-search-kind">
													{resource.kind || shortName(resource.name)}
												</span>
												{#if isDeprecated(resource)}
													<span class="dep-map-search-tag dep-map-search-tag-warn">Deprecated</span>
												{/if}
												<p class="dep-map-search-group">{groupName(resource.name)}</p>
											</div>
											{#if resource.versions.length > 0}
												<span class="dep-map-search-version">{getLatestVersion(resource)}</span>
											{/if}
										</button>
									</li>
								{/each}
							{/if}
						</ul>
					{/if}
				</div>
			</div>
		{/if}

		<div class="spec-search-results-panel">
			{#if !release}
				<div class="spec-search-empty">
					<div class="spec-search-empty-icon" aria-hidden="true">
						<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
							/>
						</svg>
					</div>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						Select a release, then search for a CRD to explore its dependency map
					</p>
				</div>
			{:else if manifestLoading && !subgraph && !buildingGraph}
				<div class="spec-search-empty">
					<svg
						class="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600 dark:text-blue-400"
						fill="none"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
					<p class="text-sm text-slate-600 dark:text-slate-400">Loading CRD catalog…</p>
				</div>
			{:else if buildingGraph}
				<div class="p-5 md:p-6" aria-live="polite" aria-busy="true">
					<div class="mb-3 flex items-center gap-3">
						<svg
							class="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400"
							fill="none"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						<div>
							<p class="text-sm font-semibold text-slate-900 dark:text-slate-100">
								Building dependency map for {focusResource || 'resource'}…
							</p>
							<p class="text-xs text-slate-500 dark:text-slate-400">
								{progress?.message || 'Analyzing schemas and inferring relationships'}
							</p>
						</div>
					</div>
					<div
						class="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
						role="progressbar"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={progressPercent}
					>
						<div
							class="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-500"
							style:width="{progress?.phase === 'done' ? 100 : progressPercent}%"
						></div>
					</div>
				</div>
			{:else if error}
				<div class="p-5 md:p-6">
					<div
						class="rounded-lg border border-red-200 bg-red-50/80 p-4 dark:border-red-800 dark:bg-red-900/20"
					>
						<p class="text-sm font-semibold text-red-900 dark:text-red-100">
							Failed to build dependency map
						</p>
						<p class="mt-1 text-xs text-red-800 dark:text-red-200">{error}</p>
						<button
							type="button"
							class="mt-3 text-sm font-medium text-red-700 underline dark:text-red-300"
							on:click={handleChangeResource}
						>
							Search again
						</button>
					</div>
				</div>
			{:else if subgraph && focusNodeId}
				<div class="dep-map-focus-banner">
					<div class="dep-map-focus-banner-inner">
						<div class="dep-map-focus-chip" aria-label="Selected resource">
							<svg class="dep-map-focus-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
							</svg>
							<div class="dep-map-focus-text">
								<span class="dep-map-focus-kind">{focusKind}</span>
								<span class="dep-map-focus-group">{focusGroup}</span>
							</div>
						</div>
						<div class="dep-map-focus-stats">
							<span class="dep-map-focus-stat">{subgraph.nodes.length} nodes</span>
							<span class="dep-map-focus-stat-sep" aria-hidden="true">·</span>
							<span class="dep-map-focus-stat">{subgraph.links.length} edges</span>
							<span class="dep-map-focus-badge">Transitive subgraph</span>
						</div>
					</div>
				</div>
				<div class="dependency-map-graph-shell">
					{#key focusNodeId}
						<DependencyMapGraph
							graph={subgraph}
							focusNodeId={focusNodeId}
							onViewCrd={handleViewCrd}
						/>
					{/key}
				</div>
			{:else}
				<div class="spec-search-empty">
					<div class="spec-search-empty-icon" aria-hidden="true">
						<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
					</div>
					<p class="text-sm font-semibold text-slate-700 dark:text-slate-300">
						Search for a CRD to explore its dependencies
					</p>
					<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
						The full release graph is not shown — only the transitive subgraph for your selected
						resource.
					</p>
				</div>
			{/if}
		</div>

		<div class="mt-4" class:dep-map-page-credits--hidden={!!subgraph}>
			<PageCredits />
		</div>
	</div>
</div>

{#if modalOpen && modalResource && release}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={release}
		allReleases={releasesConfig.releases}
		initialVersion={modalResource.versions[0]?.name ?? null}
		onClose={closeResourceModal}
	/>
{/if}

<style>
	.dep-map-focus-banner {
		border-bottom: 1px solid rgb(226 232 240);
		background: linear-gradient(to right, rgb(239 246 255), rgb(248 250 252));
		padding: 0.85rem 1rem;
	}

	:global(.dark) .dep-map-focus-banner {
		border-bottom-color: rgb(51 65 85);
		background: linear-gradient(to right, rgb(30 41 59), rgb(15 23 42));
	}

	@media (min-width: 768px) {
		.dep-map-focus-banner {
			padding: 0.85rem 1.25rem;
		}
	}

	.dep-map-focus-banner-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.dep-map-focus-chip {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.dep-map-focus-icon {
		flex-shrink: 0;
		width: 1.25rem;
		height: 1.25rem;
		color: rgb(37 99 235);
	}

	:global(.dark) .dep-map-focus-icon {
		color: rgb(96 165 250);
	}

	.dep-map-focus-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.dep-map-focus-kind {
		font-size: 1rem;
		font-weight: 700;
		color: rgb(15 23 42);
	}

	:global(.dark) .dep-map-focus-kind {
		color: rgb(241 245 249);
	}

	.dep-map-focus-group {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.7rem;
		color: rgb(100 116 139);
		word-break: break-all;
	}

	:global(.dark) .dep-map-focus-group {
		color: rgb(148 163 184);
	}

	.dep-map-focus-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.5rem;
	}

	.dep-map-focus-stat {
		font-size: 0.75rem;
		color: rgb(100 116 139);
	}

	:global(.dark) .dep-map-focus-stat {
		color: rgb(148 163 184);
	}

	.dep-map-focus-stat-sep {
		color: rgb(203 213 225);
	}

	.dep-map-focus-badge {
		padding: 0.15rem 0.55rem;
		border-radius: 9999px;
		background: rgb(219 234 254);
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: rgb(29 78 216);
	}

	:global(.dark) .dep-map-focus-badge {
		background: rgb(30 58 138 / 0.45);
		color: rgb(147 197 253);
	}

	.dep-map-search-results {
		position: absolute;
		z-index: 30;
		margin-top: 0.35rem;
		width: 100%;
		max-height: 18rem;
		overflow-y: auto;
		border: 1px solid rgb(226 232 240);
		border-radius: 0.75rem;
		background: rgb(255 255 255);
		box-shadow: 0 10px 30px rgb(15 23 42 / 0.1);
		list-style: none;
		padding: 0.35rem;
	}

	:global(.dark) .dep-map-search-results {
		border-color: rgb(51 65 85);
		background: rgb(30 41 59);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
	}

	.dep-map-search-hint,
	.dep-map-search-empty {
		padding: 0.55rem 0.75rem;
		font-size: 0.75rem;
		color: rgb(100 116 139);
	}

	.dep-map-search-row {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.12s;
	}

	.dep-map-search-row:hover,
	.dep-map-search-row-active {
		background: rgb(241 245 249);
	}

	:global(.dark) .dep-map-search-row:hover,
	:global(.dark) .dep-map-search-row-active {
		background: rgb(51 65 85);
	}

	.dep-map-search-row-main {
		min-width: 0;
		flex: 1;
	}

	.dep-map-search-kind {
		font-size: 0.875rem;
		font-weight: 600;
		color: rgb(15 23 42);
	}

	:global(.dark) .dep-map-search-kind {
		color: rgb(241 245 249);
	}

	.dep-map-search-group {
		margin: 0.15rem 0 0;
		font-size: 0.7rem;
		color: rgb(100 116 139);
	}

	:global(.dark) .dep-map-search-group {
		color: rgb(148 163 184);
	}

	.dep-map-search-version {
		flex-shrink: 0;
		padding: 0.15rem 0.45rem;
		border-radius: 0.375rem;
		background: rgb(241 245 249);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.65rem;
		color: rgb(71 85 105);
	}

	:global(.dark) .dep-map-search-version {
		background: rgb(51 65 85);
		color: rgb(203 213 225);
	}

	.dep-map-search-tag {
		margin-left: 0.35rem;
		padding: 0.05rem 0.35rem;
		border-radius: 0.25rem;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.dep-map-search-tag-warn {
		background: rgb(254 243 199);
		color: rgb(180 83 9);
	}

	:global(.dark) .dep-map-search-tag-warn {
		background: rgb(120 53 15 / 0.35);
		color: rgb(252 211 77);
	}

	:global(.dep-map-page--active) {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	:global(.dep-map-page--active .spec-search-main) {
		flex: 1;
		padding-bottom: 0.5rem;
		gap: 0.5rem;
	}

	:global(.dep-map-page--active .comparison-hero) {
		flex-shrink: 0;
		padding: 0.65rem 0.85rem;
		gap: 0.65rem;
	}

	:global(.dep-map-page--active .spec-search-filters) {
		flex-shrink: 0;
		padding: 0.5rem 0.65rem;
	}

	:global(.dep-map-page--active .spec-search-results-panel) {
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
	}

	:global(.dep-map-page--active .dep-map-focus-banner) {
		flex-shrink: 0;
	}

	.dependency-map-graph-shell {
		padding: 0.5rem 0.65rem 0.65rem;
	}

	:global(.dep-map-page--active) .dependency-map-graph-shell {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding: 0.35rem 0.5rem 0.5rem;
	}

	@media (min-width: 768px) {
		.dependency-map-graph-shell {
			padding: 0.5rem 0.75rem 0.75rem;
		}

		:global(.dep-map-page--active) .dependency-map-graph-shell {
			padding: 0.4rem 0.65rem 0.65rem;
		}
	}

	:global(.dep-map-page-credits--hidden) {
		display: none;
	}
</style>
