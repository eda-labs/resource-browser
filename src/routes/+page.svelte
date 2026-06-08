<script lang="ts">
	import { derived, writable } from 'svelte/store';
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { goto } from '$app/navigation';
import {
	loadCrdsForRelease as loadManifestCrds,
	loadVersionsForRelease as loadManifestVersions,
	loadVersionsForResource as loadManifestResourceVersions
} from '$lib/manifest';

// AnimatedBackground is provided by the layout and imported dynamically there to improve LCP
	import PageCredits from '$lib/components/PageCredits.svelte';
	import HomepageWelcome from '$lib/components/HomepageWelcome.svelte';
	import BrowseCatalog from '$lib/components/BrowseCatalog.svelte';
	import Render from '$lib/components/Render.svelte';
	// Avoid importing DiffRender on the home page — it is only useful on detail pages and is lazily loaded there
	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import { loadAllUserYaml, loadStaticYaml } from '$lib/yaml/safeYaml';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';
	import { searchResources } from '$lib/resourceSearch';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

	// Mobile panel state for compact release list (declared later)

	const defaultRelease =
		releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
	const crdMetaStore = writable<CrdResource[]>([]);
	const resourceSearch = writable('');
	const selectedRelease = writable<EdaRelease>(defaultRelease);
	const releaseFolder = derived(selectedRelease, ($selectedRelease) => $selectedRelease.folder);
	const resourceSearchFilter = derived([resourceSearch, crdMetaStore], ([$resourceSearch, $crdMetaStore]) =>
		searchResources($crdMetaStore, $resourceSearch).map((resource) => resource.name)
	);
	// Group releases by major version (e.g., 25 -> v25)
	// Use numeric version comparison to ensure newest releases sort first (by major, minor, patch).
	let groupedReleases = (() => {
		const groups: Record<string, any[]> = {};
		(releasesConfig.releases || []).forEach((r) => {
			const major = String(r.name).split('.')[0];
			const label = `v${major}`;
			groups[label] = groups[label] || [];
			groups[label].push(r);
		});

		function parseVersion(name: string) {
			return String(name)
				.split('.')
				.map((n) => parseInt(n, 10) || 0);
		}

		function compareReleaseDesc(a: { name: string }, b: { name: string }) {
			const pa = parseVersion(a.name);
			const pb = parseVersion(b.name);
			const len = Math.max(pa.length, pb.length);
			for (let i = 0; i < len; i++) {
				const na = pa[i] || 0;
				const nb = pb[i] || 0;
				if (na > nb) return -1; // a is newer -> come first
				if (na < nb) return 1; // b is newer -> a after b
			}
			return 0;
		}

		// sort groups by major desc
		return Object.entries(groups)
			.sort((a, b) => parseInt(b[0].replace('v', '')) - parseInt(a[0].replace('v', '')))
			.map(([label, releases]) => ({
				label,
				releases: releases.sort(compareReleaseDesc)
			}));
	})();

	let selectedResource: string | null = null;
	let selectedVersion: string | null = null;
	let resourceData: any = null;
	let loading = false;
	let showBrowseMode = false;
	let mobileMenuOpen = false;
	let showDiff = false;
	let compareVersion: string | null = null;
	let compareData: any = null;
	let viewMode: 'schema' | 'validate' = 'schema';
	let selectedCompareVersion: string | null = null;
	let showReleaseComparison = false;
	let compareRelease: EdaRelease | null = null;
	let compareReleaseData: any = null;
	let compareReleaseVersions: string[] = [];

	let yamlInput = '';
	let validationErrors: any[] = [];
	let isValidating = false;
	let validationResult: 'valid' | 'invalid' | null = null;
	let releaseAvailability: Map<string, boolean> = new Map();

	$: currentResourceDef = selectedResource
		? $crdMetaStore.find((x) => x.name === selectedResource)
		: null;
	// Filter out CRDs that match the status filter and exclude 'states' CRDs from UI

	$: resourceInfo = resourceData
		? {
				kind: resourceData.spec?.names?.kind || '',
				group: resourceData.spec?.group || '',
				name: selectedResource || ''
			}
		: null;
	$: if (selectedResource || selectedVersion) {
		releaseAvailability.clear();
	}
	// Defer initial heavy manifest load until after paint to improve LCP (use requestIdleCallback where available)
	let initialLoaded = false;
	onMount(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const releaseParam = urlParams.get('release');
		const browseParam = urlParams.get('browse');
		if (releaseParam) {
			const foundRelease = releasesConfig.releases.find((r) => r.name === releaseParam);
			if (foundRelease) {
				selectedRelease.set(foundRelease);
			}
		}
		if (browseParam === 'true') {
			showBrowseMode = true;
		}

		const startLoad = () => {
			loadCrdsForRelease($selectedRelease);
			initialLoaded = true;
		};
		if (typeof (window as any).requestIdleCallback === 'function') {
			(window as any).requestIdleCallback(startLoad);
		} else {
			setTimeout(startLoad, 200);
		}
	});
	// After initial load, reactively reload when selectedRelease changes.
	$: if (initialLoaded) {
		loadCrdsForRelease($selectedRelease);
		selectedResource = null;
		selectedVersion = null;
		resourceData = null;
	}

	let previousBrowseRelease = '';
	$: if (browser && initialLoaded && showBrowseMode && !selectedResource) {
		const name = $selectedRelease.name;
		if (name !== previousBrowseRelease) {
			previousBrowseRelease = name;
			syncBrowseUrl(name);
		}
	}

	function syncBrowseUrl(releaseName: string) {
		if (!browser || !showBrowseMode) return;
		const params = new URLSearchParams();
		params.set('browse', 'true');
		params.set('release', releaseName);
		const targetUrl = `/?${params.toString()}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
	}
	// When the selected release object changes, load versions and set version lists
	$: if (compareRelease && selectedResource) {
		loadVersionsForResourceInRelease(compareRelease, selectedResource).then((versions) => {
			compareReleaseVersions = versions;
		});
	} else {
		compareReleaseVersions = [];
	}
	$: updateRootScroll();

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.documentElement.classList.remove('no-root-scroll');
			document.body.classList.remove('no-root-scroll');
		}
	});

	function formatResourceName(name: string): string {
		return name.split('.')[0] || name;
	}
	function formatGroupName(name: string): string {
		return name.split('.').slice(1).join('.') || name;
	}
	function updateRootScroll() {
		if (typeof window === 'undefined') return;
		try {
			const isWelcomeScreen = !selectedResource && !showBrowseMode;
			if (isWelcomeScreen) {
				// Always allow scrolling on homepage
				document.documentElement.classList.remove('no-root-scroll');
				document.body.classList.remove('no-root-scroll');
			} else {
				document.documentElement.classList.remove('no-root-scroll');
				document.body.classList.remove('no-root-scroll');
			}
		} catch (e) {}
	}
	function handleGlobalExpand() {
		expandAllScope.set('global');
		if ($ulExpanded.length > 0) {
			expandAll.set(false);
		} else {
			expandAll.set(true);
		}
	}
	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
	}

	async function loadCrdsForRelease(release: EdaRelease): Promise<CrdResource[]> {
		const manifest = await loadManifestCrds(release);
		crdMetaStore.set(manifest);
		return manifest;
	}
	async function loadVersionsForRelease(release: EdaRelease): Promise<string[]> {
		return loadManifestVersions(release);
	}
	async function loadVersionsForResourceInRelease(
		release: EdaRelease,
		resourceName: string
	): Promise<string[]> {
		return loadManifestResourceVersions(release, resourceName);
	}
	async function selectResource(resourceName: string, version: string) {
		selectedResource = resourceName;
		selectedVersion = version;
		loading = true;
		showDiff = false;
		compareVersion = null;
		compareData = null;
		showReleaseComparison = false;
		compareRelease = null;
		compareReleaseData = null;
		mobileMenuOpen = false;
		expandAll.set(false);
		expandAllScope.set('local');
		ulExpanded.set([]);
		try {
			const folder = $releaseFolder;
			const response = await fetch(`/${folder}/${resourceName}/${version}.yaml`);
			if (!response.ok) throw new Error('Failed to load resource');
			const yamlText = await response.text();
			resourceData = loadStaticYaml(yamlText) as any;
		} catch (error) {
			resourceData = null;
		} finally {
			loading = false;
		}
	}

	async function enterBrowseMode(release: EdaRelease) {
		showBrowseMode = true;
		previousBrowseRelease = release.name;
		selectedRelease.set(release);
		await loadCrdsForRelease(release);
		goto(`/?browse=true&release=${release.name}`, { replaceState: true, keepFocus: true });
	}

	function exitBrowseMode() {
		showBrowseMode = false;
		mobileMenuOpen = false;
		resourceSearch.set('');
		goto('/', { replaceState: true });
	}

	async function handleBrowseReleaseChange(release: EdaRelease) {
		selectedRelease.set(release);
		await loadCrdsForRelease(release);
		goto(`/?browse=true&release=${release.name}`, { replaceState: true, keepFocus: true });
	}

	async function handleHomeResourceClick(resourceName: string) {
		await loadCrdsForRelease($selectedRelease);
		const resourceInRelease = $crdMetaStore.find((r) => r.name === resourceName);
		showBrowseMode = true;
		previousBrowseRelease = $selectedRelease.name;
		const release = encodeURIComponent($selectedRelease.name);
		if (resourceInRelease) {
			goto(`/?browse=true&release=${release}&resource=${encodeURIComponent(resourceName)}`, {
				keepFocus: true
			});
		} else {
			goto(`/?browse=true&release=${release}`, { keepFocus: true });
		}
	}

	function clearBrowseResourceFromUrl() {
		if (!browser || !showBrowseMode) return;
		const params = new URLSearchParams($page.url.search);
		if (!params.has('resource')) return;
		params.delete('resource');
		const targetUrl = `/?${params.toString()}`;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
	}
	async function toggleDiff(version: string) {
		if (showDiff && compareVersion === version) {
			showDiff = false;
			compareVersion = null;
			compareData = null;
			return;
		}
		try {
			const folder = $releaseFolder;
			const response = await fetch(`/${folder}/${selectedResource}/${version}.yaml`);
			if (!response.ok) throw new Error('Failed');
			const yamlText = await response.text();
			compareData = loadStaticYaml(yamlText) as any;
			compareVersion = version;
			showDiff = true;
		} catch (error) {
			compareData = null;
		}
	}

	async function toggleReleaseComparison(release: EdaRelease) {
		if (showReleaseComparison && compareRelease?.name === release.name) {
			showReleaseComparison = false;
			compareRelease = null;
			compareReleaseData = null;
			return;
		}
		try {
			const response = await fetch(
				`/${release.folder}/${selectedResource}/${selectedVersion}.yaml`
			);
			if (!response.ok) {
				alert(`Not available in ${release.label}`);
				return;
			}
			const yamlText = await response.text();
			compareReleaseData = loadStaticYaml(yamlText) as any;
			compareRelease = release;
			showReleaseComparison = true;
			showDiff = false;
			compareVersion = null;
			compareData = null;
		} catch (error) {
			alert(`Failed to load`);
			compareReleaseData = null;
			showReleaseComparison = false;
			compareRelease = null;
		}
	}

	// CSV helper

	async function validateYaml() {
		const { default: Ajv } = await import('ajv');
		if (!yamlInput.trim()) {
			validationErrors = [];
			validationResult = null;
			return;
		}
		isValidating = true;
		validationErrors = [];
		validationResult = null;
		try {
			const parsedDocs: any[] = [];
			parsedDocs.push(...loadAllUserYaml(yamlInput));
			if (parsedDocs.length === 0) {
				validationErrors = [{ message: 'No valid YAML' }];
				validationResult = 'invalid';
				isValidating = false;
				return;
			}
			const specSchema = resourceData?.schema?.openAPIV3Schema?.properties?.spec;
			if (!specSchema) {
				validationErrors = [{ message: 'No schema' }];
				validationResult = 'invalid';
				isValidating = false;
				return;
			}
			const ajv = new Ajv({ allErrors: true } as any);
			let valid = true;
			const errors: any[] = [];
			parsedDocs.forEach((parsedYaml) => {
				if (!parsedYaml.spec) {
					errors.push({ instancePath: '/spec', message: 'Missing spec' });
					valid = false;
					return;
				}
				try {
					const validator = ajv.compile(specSchema);
					const isValid = validator(parsedYaml.spec);
					if (!isValid && validator.errors) {
						valid = false;
						errors.push(
							...validator.errors.map((e: any) => ({
								instancePath: e.instancePath || '/spec',
								message: e.message || 'Error'
							}))
						);
					}
				} catch (e) {
					valid = false;
					errors.push({ instancePath: '/spec', message: 'Validation error' });
				}
			});
			if (valid) {
				validationResult = 'valid';
			} else {
				validationErrors = errors;
				validationResult = 'invalid';
			}
		} catch (error) {
			validationErrors = [{ message: 'YAML error' }];
			validationResult = 'invalid';
		} finally {
			isValidating = false;
		}
	}
</script>

<svelte:head>
	<title
		>EDA Resource Browser{selectedResource
			? ` | ${resourceInfo?.kind || selectedResource}`
			: ''}</title
	>
	<meta
		name="description"
		content="Browse Nokia EDA Custom Resource Definitions (CRDs), compare versions, and validate resource YAML in a single searchable interface."
	/>
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href="{$page.url.href}" />
</svelte:head>

<div
	class="relative flex flex-col {selectedResource
		? 'pt-14 md:pt-16 lg:h-screen lg:overflow-hidden'
		: ''}"
>
	<div class="relative z-10 flex flex-1 flex-col lg:flex-row">
		{#if selectedResource}
			<button
				on:click={toggleMobileMenu}
				class="no-blur fixed top-4 left-6 z-60 rounded-lg bg-blue-600 p-2 text-white shadow-xl"
				aria-label="Toggle menu"
			>
				<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					{#if mobileMenuOpen}<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					{:else}<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>{/if}
				</svg>
			</button>
		{/if}
		{#if selectedResource}
			<div
				class="{mobileMenuOpen
					? 'translate-x-0'
					: '-translate-x-full lg:translate-x-0'} fixed inset-y-0 left-0 z-40 flex w-80 flex-shrink-0 flex-col border-r border-gray-200 bg-white shadow-xl transition-transform duration-300 lg:w-64 dark:border-gray-700 dark:bg-gray-900"
			>
				<div class="border-b border-gray-200 p-4 dark:border-gray-700">
					<button
						on:click={exitBrowseMode}
						class="group flex items-center space-x-2"
					>
						<img src="/images/eda.svg" width="48" height="48" alt="Nokia EDA" />
						<div>
							<h1
								class="font-nokia-headline text-4xl leading-tight font-extrabold text-yellow-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] md:text-5xl lg:text-6xl"
							>
								Nokia EDA
							</h1>
							<p class="font-nokia-headline mt-1 text-sm font-light text-amber-500 md:text-base dark:text-white">
								Resource Browser
							</p>
						</div>
					</button>
					<div class="relative mt-4">
						<input
							id="resource-search-input"
							type="text"
							placeholder="Search resources..."
							bind:value={$resourceSearch}
							class="w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-10 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
						/>
					</div>
				</div>
				<div class="flex-1 overflow-y-auto p-3">
					<ul class="space-y-1">
						{#each $resourceSearchFilter as resource}
							{@const resDef = $crdMetaStore.filter((x) => x.name == resource)[0]}
							{#if resDef}
								<li>
									<button
										class="w-full rounded-lg px-3 py-2 text-left transition-colors {resource ===
										selectedResource
											? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
											: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
										on:click={() => handleHomeResourceClick(resource)}
										><span class="text-sm font-medium"
											>{resDef.kind || resDef.name.split('.')[0]}</span
										></button
									>
								</li>
							{/if}
						{/each}
					</ul>
				</div>
			</div>
		{/if}
		{#if mobileMenuOpen && selectedResource}<button
				class="fixed inset-0 z-30 bg-black/50 lg:hidden"
				on:click={() => (mobileMenuOpen = false)}
				aria-label="Close"
			></button>{/if}

		<div
			id="main-scroll"
			class="relative flex flex-1 flex-col {selectedResource || showBrowseMode
				? 'overflow-y-auto'
				: ''}"
		>
			{#if !selectedResource && !showBrowseMode}
				<HomepageWelcome
					{groupedReleases}
					{selectedRelease}
					{crdMetaStore}
					onResourceSelect={handleHomeResourceClick}
					onBrowseRelease={enterBrowseMode}
				/>
			{:else if showBrowseMode && !selectedResource}
				<BrowseCatalog
					allResources={$crdMetaStore}
					selectedRelease={$selectedRelease}
					allReleases={releasesConfig.releases}
					initialResourceName={$page.url.searchParams.get('resource')}
					onReleaseChange={handleBrowseReleaseChange}
					onExitBrowse={exitBrowseMode}
					onResourceModalClose={clearBrowseResourceFromUrl}
				/>
			{:else if loading}
				<div class="flex flex-1 items-center justify-center bg-gray-50 dark:bg-gray-800">
					<div class="text-center">
						<svg
							class="mx-auto mb-4 h-12 w-12 animate-spin text-blue-600"
							fill="none"
							viewBox="0 0 24 24"
						>
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						<p class="text-gray-600 dark:text-gray-300">Loading resource...</p>
					</div>
				</div>
			{:else if resourceData}
				<div class="flex-1 bg-gray-50 dark:bg-gray-800">
					<div class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
						<div
							class="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
						>
							<div class="border-b border-gray-200 p-6 pl-14 lg:pl-6 dark:border-gray-700">
								<div class="mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between">
									<div>
										<h2 class="mb-1 text-2xl font-bold text-gray-900 dark:text-white">
											{formatResourceName(resourceInfo?.name || '')}
										</h2>
										<p class="font-mono text-sm text-gray-600 dark:text-gray-300">
											{formatGroupName(resourceInfo?.name || '')}
										</p>
									</div>
									<div class="mt-4 flex items-center space-x-2 lg:mt-0">
										<button
											on:click={() => (viewMode = 'schema')}
											class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {viewMode ===
											'schema'
												? 'bg-blue-600 text-white'
												: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
										>
											Schema
										</button>
										<button
											on:click={() => (viewMode = 'validate')}
											class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {viewMode ===
											'validate'
												? 'bg-blue-600 text-white'
												: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
										>
											Validate
										</button>
									</div>
								</div>
							</div>

							<div class="p-6">
								{#if viewMode === 'schema'}
									<Render
										hash=""
										source="eda"
										type="spec"
										data={resourceData.schema.openAPIV3Schema.properties.spec}
										showType={false}
										onResourcePage={true}
									/>
								{:else}
									<div class="space-y-4">
										<div>
											<label
												for="yaml-input"
												class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
											>
												Paste your YAML configuration
											</label>
											<textarea
												id="yaml-input"
												bind:value={yamlInput}
												placeholder="apiVersion: ...\nkind: ...\nmetadata:\n  name: ...\nspec:\n  ..."
												rows="12"
												class="w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
											></textarea>
										</div>
										<div class="flex justify-end">
											<button
												on:click={validateYaml}
												disabled={isValidating || !yamlInput.trim()}
												class="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
											>
												{isValidating ? 'Validating...' : 'Validate YAML'}
											</button>
										</div>
										{#if validationResult === 'valid'}
											<div
												class="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20"
											>
												<div class="flex items-start space-x-3">
													<svg
														class="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
														/>
													</svg>
													<div>
														<p class="font-medium text-green-900 dark:text-green-300">
															Valid Configuration
														</p>
														<p class="mt-1 text-sm text-green-800 dark:text-green-400">
															Your YAML matches the schema requirements.
														</p>
													</div>
												</div>
											</div>
										{/if}
										{#if validationResult === 'invalid' && validationErrors.length > 0}
											<div
												class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
											>
												<div class="flex items-start space-x-3">
													<svg
														class="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
														/>
													</svg>
													<div class="flex-1">
														<p class="mb-2 font-medium text-red-900 dark:text-red-300">
															Validation Errors ({validationErrors.length})
														</p>
														<ul class="space-y-2">
															{#each validationErrors as error}
																<li class="text-sm text-red-800 dark:text-red-400">
																	<span
																		class="rounded bg-red-100 px-2 py-1 font-mono text-xs dark:bg-red-900/30"
																		>{error.instancePath || '/'}</span
																	>
																	<span class="ml-2">{error.message}</span>
																</li>
															{/each}
														</ul>
													</div>
												</div>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	{#if !showBrowseMode || selectedResource}
		<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
			<PageCredits />
		</div>
	{/if}
</div>
