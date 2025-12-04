<script lang="ts">
	import { page } from '$app/stores';
	import { derived, writable } from 'svelte/store';
	import { onMount, onDestroy } from 'svelte';

	import PageCredits from '$lib/components/PageCredits.svelte';
	import TopHeader from '$lib/components/TopHeader.svelte';
	import Render from '$lib/components/Render.svelte';
	// Load DiffRender lazily to avoid including it in the initial bundle; it's only needed for compare view
	let DiffRender: any = null;

	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';

	export let data;

	// Declare all variables that come from data
	let name: string;
	let versionOnFocus: string;
	let kind: string;
	let group: string;
	let deprecated: boolean;
	let appVersion: string;
	let validVersions: string[];
	let spec: any;
	let status: any;
	let releaseFolder: string;
	let releaseLabel: string;
	let allReleases: any[];
	let releaseManifest: any[];

	let clientDeprecatedSince: string | null = null;

	// Make data reactive - update when data changes
	$: ({
		name,
		versionOnFocus,
		kind,
		group,
		deprecated,
		appVersion,
		validVersions,
		spec,
		status,
		releaseFolder,
		releaseLabel,
		allReleases,
		releaseManifest
	} = data);
	$: clientDeprecatedSince = data && 'deprecatedSince' in data ? data.deprecatedSince : null;

	onMount(() => {
		// If no SSR value for deprecatedSince, compute it lazily in the background
		if (clientDeprecatedSince == null && deprecated) {
			const compute = async () => {
				try {
					// iterate releases in chronological order (old to new), same as before
					// iterate releases in chronological order (old to new)
					const releases = allReleases?.slice?.(0).reverse?.() || [];
					for (const r of releases) {
						try {
							const res = await fetch(`/${r.folder}/manifest.json`);
							if (!res.ok) continue;
							const manifest = await res.json();
							const entry = manifest.find((x: any) => x.name === name);
							if (!entry || !entry.versions) continue;
							const v = entry.versions.find((vv: any) => vv.name === versionOnFocus);
							if (v && v.deprecated) {
								clientDeprecatedSince = r.label || r.name;
								break;
							}
						} catch (e) {
							/* ignore and continue */
						}
					}
				} catch (e) {
					/* ignore */
				}
			};

			if (typeof (window as any).requestIdleCallback === 'function') {
				(window as any).requestIdleCallback(() => compute());
			} else {
				setTimeout(() => compute(), 1000);
			}
		}
	});

	$: hash = $page.url.hash?.substring(1);

	expandAll.set(false);
	expandAllScope.set('local');

	// If the URL contains a hash like `spec.some.path`, expand the tree to that path
	$: if (typeof hash !== 'undefined' && hash && hash.length > 0) {
		const parts = hash.split('.');
		const ancestors: string[] = [];
		for (let i = 1; i <= parts.length; i++) {
			ancestors.push(parts.slice(0, i).join('.'));
		}
		ulExpanded.set(ancestors);
		// After a short delay (allow DOM to render and tree to expand), focus and scroll to the element
		setTimeout(() => {
			try {
				const target = document.getElementById(hash);
				if (target) {
					// ensure it's focusable
					if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
					(target as HTMLElement).focus({ preventScroll: true });
					// smooth scroll into view and center the element
					(target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			} catch (e) {
				// ignore
			}
		}, 80);
	} else {
		ulExpanded.set([]);
	}

	// View mode state - start with schema view showing both spec and status
	let viewMode: 'schema' | 'compare' = 'schema';

	// Comparison state
	let compareVersion: string | null = null;
	let compareRelease: string | null = null;
	let comparisonResult: any = null;
	let isComparing = false;
	let compareReleaseVersions: string[] = [];

	// Load versions when compareRelease changes
	$: if (compareRelease && name) {
		loadVersionsForCompareRelease(compareRelease, name);
	} else if (!compareRelease) {
		compareReleaseVersions = validVersions;
	}

	async function loadVersionsForCompareRelease(releaseName: string, resourceName: string) {
		try {
			const release = allReleases.find((r) => r.name === releaseName);
			if (!release) {
				console.warn('Release not found:', releaseName);
				compareReleaseVersions = [];
				return;
			}
			// Try to load the release manifest and extract versions for the requested resource
			try {
				const resp = await fetch(`/${release.folder}/manifest.json`);
				if (resp.ok) {
					const manifest = await resp.json();
					const entry = manifest.find((m: any) => m.name === resourceName);
					if (entry && entry.versions) {
						compareReleaseVersions = entry.versions.map((v: any) => v.name);
						return;
					}
				}
			} catch (innerErr) {
				// We ignore inner manifest fetch errors and fall through to empty versions
				console.warn('Could not fetch manifest for compare release', releaseName, innerErr);
			}
			compareReleaseVersions = [];
			return;
		} catch (e) {
			console.warn(`Could not load versions for ${resourceName} in release ${releaseName}`, e);
			compareReleaseVersions = [];
		}
	}

	function handleGlobalExpand() {
		expandAllScope.set('global');
		if ($ulExpanded.length > 0) {
			expandAll.set(false);
		} else {
			expandAll.set(true);
		}
	}

	async function handleVersionChange() {
		if (!compareVersion || (compareVersion === versionOnFocus && !compareRelease)) {
			comparisonResult = null;
			return;
		}

		isComparing = true;
		comparisonResult = null;

		try {
			let fetchFolder = releaseFolder;
			if (compareRelease) {
				const selectedRelease = allReleases.find((r) => r.name === compareRelease);
				if (selectedRelease) {
					fetchFolder = selectedRelease.folder;
				}
			}

			let response = await fetch(`/${fetchFolder}/${name}/${compareVersion}.yaml`);

			if (!response.ok) {
				response = await fetch(`/resources/${name}/${compareVersion}.yaml`);
			}

			if (!response.ok) {
				console.error('Failed to fetch comparison version');
				isComparing = false;
				return;
			}

			const crdText = await response.text();
			const { default: yamlLib } = await import('js-yaml');
			const crd = yamlLib.load(crdText) as any;
			const compareSpec = crd.schema.openAPIV3Schema.properties.spec;
			const compareStatus = crd.schema.openAPIV3Schema.properties.status;

			comparisonResult = {
				baseVersion: versionOnFocus,
				compareVersion: compareVersion,
				baseRelease: releaseLabel,
				compareRelease: compareRelease
					? allReleases.find((r) => r.name === compareRelease)?.label
					: releaseLabel,
				baseSpec: spec,
				compareSpec: compareSpec,
				baseStatus: status,
				compareStatus: compareStatus
			};
		} catch (error) {
			console.error('Error comparing versions:', error);
		}

		isComparing = false;
	}

	$: if (compareVersion || compareRelease) {
		handleVersionChange();
	}
	$: if (viewMode === 'compare') {
		// Load diff renderer lazily to avoid heavy initial bundle/hydration
		if (!DiffRender) {
			if (typeof (window as any).requestIdleCallback === 'function') {
				(window as any).requestIdleCallback(async () => {
					const m = await import('$lib/components/DiffRender.svelte');
					DiffRender = m.default;
				});
			} else {
				setTimeout(async () => {
					const m = await import('$lib/components/DiffRender.svelte');
					DiffRender = m.default;
				}, 200);
			}
		}
	}

	$: if (name || versionOnFocus) {
		compareVersion = null;
		compareRelease = null;
		comparisonResult = null;
		viewMode = 'schema';
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | {name} {versionOnFocus}</title>
</svelte:head>

{#key `${name}-${versionOnFocus}`}
	<TopHeader
		{name}
		{versionOnFocus}
		{validVersions}
		{deprecated}
		deprecatedSince={clientDeprecatedSince}
		{kind}
		subtitle={releaseLabel}
	/>

	<div class="relative flex min-h-screen flex-col overflow-hidden pt-14 md:pt-16">
		<div class="relative flex-1">
			<main class="flex-1 px-3 pt-3 pb-8 md:px-6 md:pt-4 lg:px-8">
				<div class="mx-auto w-full max-w-7xl">
					<!-- Ultra-Compact Control Panel -->
					<div
						class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800"
					>
						<!-- View Mode Tabs -->
						<div class="flex items-center gap-1.5 rounded-md bg-gray-100 p-1 dark:bg-gray-900/50">
							<button
								on:click={() => (viewMode = 'schema')}
								class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {viewMode ===
								'schema'
									? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm'
									: 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'}"
							>
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
								<span>Schema</span>
							</button>
						<button
							on:click={() => (viewMode = 'compare')}
							class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all {viewMode ===
							'compare'
								? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-sm'
								: 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'}"
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
								/>
							</svg>
							<span>Compare</span>
						</button>
					</div>						<!-- Expand/Collapse Button -->
						<button
							class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 {$ulExpanded.length >
							0
								? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
								: 'border-cyan-500 bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-600'}"
							on:click={handleGlobalExpand}
						>
							<svg
								class="h-3.5 w-3.5 transition-transform {$ulExpanded.length > 0
									? 'rotate-180'
									: 'rotate-0'}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 9l-7 7-7-7"
								/>
							</svg>
							<span>{$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} All</span>
						</button>
					</div>

					<!-- Schema Section -->
					{#if viewMode === 'schema'}
						<div class="space-y-4">
							<!-- Specification Section -->
							<div
								class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
							>
								<div
									class="border-b border-gray-100 bg-gradient-to-r from-cyan-50 to-blue-50 px-4 py-2.5 dark:border-gray-700 dark:from-cyan-900/20 dark:to-blue-900/20"
								>
									<div class="flex items-center gap-2">
										<div
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
										</div>
										<div>
											<h2 class="text-sm font-bold text-gray-900 dark:text-white">Specification</h2>
											<p class="text-xs text-gray-600 dark:text-gray-400">Required configuration</p>
										</div>
									</div>
								</div>
								<div class="overflow-x-auto p-4">
									<Render
										{hash}
										source={'eda'}
										type={'spec'}
										data={spec}
										showType={false}
										onResourcePage={true}
									/>
								</div>
							</div>

							<!-- Status Section -->
							<div
								class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
							>
								<div
									class="border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-2.5 dark:border-gray-700 dark:from-green-900/20 dark:to-emerald-900/20"
								>
									<div class="flex items-center gap-2">
										<div
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-sm"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
										</div>
										<div>
											<h2 class="text-sm font-bold text-gray-900 dark:text-white">Status</h2>
											<p class="text-xs text-gray-600 dark:text-gray-400">Runtime status fields</p>
										</div>
									</div>
								</div>
								<div class="overflow-x-auto p-4">
									<Render
										{hash}
										source={'eda'}
										type={'status'}
										data={status}
										showType={false}
										onResourcePage={true}
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Compare Section -->
					{#if viewMode === 'compare'}
						<div
							class="mt-6 overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-sm backdrop-blur-lg md:mt-10 md:rounded-xl"
						>
							<div
								class="content-header border-b border-white/10 bg-black/20 px-4 py-4 md:px-8 md:py-6"
							>
								<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
									<div class="flex items-center space-x-3 md:space-x-4">
										<div
											class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-600 to-amber-600 text-white shadow-xl md:h-12 md:w-12 md:rounded-xl"
										>
											<svg
												class="h-5 w-5 md:h-6 md:w-6"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
												/>
											</svg>
										</div>
										<div class="min-w-0">
											<h2 class="text-lg font-semibold text-white md:text-2xl">Comparison</h2>
											<p class="mt-0.5 text-xs text-gray-300 md:text-sm">
												Compare schemas across versions
											</p>
										</div>
									</div>
									<!-- Selectors -->
									<div class="flex w-full flex-col gap-3 sm:flex-row sm:gap-3 md:w-auto">
										<div class="flex flex-col gap-1.5">
											<div class="text-xs font-semibold tracking-wide text-gray-300 uppercase">
												Release
											</div>
											<div class="relative">
												<select
													bind:value={compareRelease}
													on:change={() => {
														compareVersion = null;
													}}
													class="w-full cursor-pointer appearance-none rounded-lg border border-white/20 bg-black/30 py-2 pr-8 pl-3 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:border-cyan-400 hover:shadow-lg focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 focus:outline-none sm:min-w-[140px] md:min-w-[180px] md:rounded-xl md:py-2.5 md:pr-10 md:pl-4 md:text-sm"
												>
													<option value="" class="bg-gray-900 text-white"
														>Current ({releaseLabel})</option
													>
													{#each allReleases as release}
														{#if release.label !== releaseLabel}
															<option value={release.name} class="bg-gray-900 text-white"
																>{release.label}</option
															>
														{/if}
													{/each}
												</select>
												<div
													class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3"
												>
													<svg
														class="h-4 w-4 text-gray-400 md:h-5 md:w-5 dark:text-gray-500"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 9l-7 7-7-7"
														/>
													</svg>
												</div>
											</div>
										</div>
										<div class="flex flex-col gap-1.5">
											<div class="text-xs font-semibold tracking-wide text-gray-300 uppercase">
												Version
											</div>
											<div class="relative">
												<select
													bind:value={compareVersion}
													class="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white py-2 pr-8 pl-3 text-xs font-semibold text-gray-900 shadow-sm transition-all duration-200 hover:border-blue-400 hover:shadow-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:shadow-sm sm:min-w-[130px] md:min-w-[160px] md:rounded-xl md:py-2.5 md:pr-10 md:pl-4 md:text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/10 dark:disabled:hover:border-gray-700"
													disabled={compareReleaseVersions.length === 0}
													aria-label="Select version to compare"
												>
													<option
														value=""
														class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
													>
														{compareReleaseVersions.length === 0 ? 'No versions' : 'Select...'}
													</option>
													{#each compareReleaseVersions as version}
														<option
															value={version}
															class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
															>{version}</option
														>
													{/each}
												</select>
												<div
													class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 md:pr-3"
												>
													<svg
														class="h-4 w-4 text-gray-400 md:h-5 md:w-5 dark:text-gray-500"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 9l-7 7-7-7"
														/>
													</svg>
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>
							<div class="overflow-x-auto bg-white p-4 md:p-8 dark:bg-gray-800">
								{#if !compareVersion}
									<div class="flex flex-col items-center justify-center py-8 text-center md:py-12">
										<svg
											class="mb-3 h-12 w-12 text-gray-400 md:mb-4 md:h-16 md:w-16 dark:text-gray-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
											/>
										</svg>
										<h3
											class="mb-1 text-base font-semibold text-gray-700 md:mb-2 md:text-lg dark:text-gray-300"
										>
											No Version Selected
										</h3>
										<p class="max-w-md text-xs text-gray-600 md:text-sm dark:text-gray-300">
											Select a version to compare with {versionOnFocus}.
										</p>
									</div>
								{:else if isComparing}
									<div class="flex items-center justify-center py-8 md:py-12">
										<div
											class="h-10 w-10 animate-spin rounded-full border-b-2 border-orange-600 md:h-12 md:w-12"
										></div>
									</div>
								{:else if comparisonResult}
									<div class="space-y-6 md:space-y-8">
										<!-- Comparison Header -->
										<div
											class="flex items-center justify-center overflow-x-auto rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-2 md:p-3 dark:border-orange-800 dark:from-orange-900/20 dark:to-amber-900/20"
										>
											<div class="flex items-center space-x-2 md:space-x-4">
												<div
													class="flex flex-shrink-0 items-center gap-2 text-sm whitespace-nowrap md:text-sm"
												>
													<span
														class="inline-block max-w-[10rem] truncate text-xs font-semibold text-blue-600 sm:max-w-[12rem] md:text-sm dark:text-blue-400"
														>{comparisonResult.baseRelease}</span
													>
													<span
														class="ml-1 text-xs font-semibold text-orange-700 md:text-sm dark:text-orange-400"
														>{versionOnFocus}</span
													>
												</div>
												<svg
													class="h-5 w-5 flex-shrink-0 text-gray-400 md:h-6 md:w-6"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M13 7l5 5m0 0l-5 5m5-5H6"
													/>
												</svg>
												<div
													class="flex flex-shrink-0 items-center gap-2 text-sm whitespace-nowrap md:text-sm"
												>
													<span
														class="inline-block max-w-[10rem] truncate text-xs font-semibold text-blue-600 sm:max-w-[12rem] md:text-sm dark:text-blue-400"
														>{comparisonResult.compareRelease}</span
													>
													<span
														class="ml-1 text-xs font-semibold text-orange-700 md:text-sm dark:text-orange-400"
														>{compareVersion}</span
													>
												</div>
											</div>
										</div>

										<!-- Specification Comparison -->
										<div>
											<h3
												class="mb-3 flex items-center space-x-2 text-sm font-semibold text-gray-900 md:mb-4 md:text-base dark:text-white"
											>
												<svg
													class="h-4 w-4 flex-shrink-0 text-blue-600 md:h-5 md:w-5"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
													/>
												</svg>
												<span>Specification</span>
											</h3>
											<div class="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
												<div class="space-y-2 md:space-y-3">
													<h4
														class="border-b border-gray-200 pb-2 text-xs font-semibold text-gray-700 md:text-sm dark:border-gray-700 dark:text-gray-300"
													>
														{versionOnFocus}
													</h4>
													<div
														class="overflow-x-auto rounded-lg bg-gray-50 p-2 md:p-3 dark:bg-gray-900"
													>
														{#if DiffRender}
															<svelte:component
																this={DiffRender}
																hash=""
																source="eda"
																type="spec"
																leftData={spec}
																rightData={comparisonResult.compareSpec}
																side="left"
															/>
														{:else}
															<div class="text-sm text-gray-600 dark:text-gray-400">
																Loading comparison UI…
															</div>
														{/if}
													</div>
												</div>
												<div class="space-y-2 md:space-y-3">
													<h4
														class="border-b border-gray-200 pb-2 text-xs font-semibold text-gray-700 md:text-sm dark:border-gray-700 dark:text-gray-300"
													>
														{compareVersion}
													</h4>
													<div
														class="overflow-x-auto rounded-lg bg-gray-50 p-2 md:p-3 dark:bg-gray-900"
													>
														{#if DiffRender}
															<svelte:component
																this={DiffRender}
																hash=""
																source="eda"
																type="spec"
																leftData={spec}
																rightData={comparisonResult.compareSpec}
																side="right"
															/>
														{:else}
															<div class="text-sm text-gray-600 dark:text-gray-400">
																Loading comparison UI…
															</div>
														{/if}
													</div>
												</div>
											</div>
										</div>

										<!-- Status Comparison -->
										<div>
											<h3
												class="mb-3 flex items-center space-x-2 text-sm font-semibold text-gray-900 md:mb-4 md:text-base dark:text-white"
											>
												<svg
													class="h-4 w-4 flex-shrink-0 text-green-600 md:h-5 md:w-5"
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
												<span>Status</span>
											</h3>
											<div class="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
												<div class="space-y-2 md:space-y-3">
													<h4
														class="border-b border-gray-200 pb-2 text-xs font-semibold text-gray-700 md:text-sm dark:border-gray-700 dark:text-gray-300"
													>
														{versionOnFocus}
													</h4>
													<div
														class="overflow-x-auto rounded-lg bg-gray-50 p-2 md:p-3 dark:bg-gray-900"
													>
														{#if DiffRender}
															<svelte:component
																this={DiffRender}
																hash=""
																source="eda"
																type="status"
																leftData={status}
																rightData={comparisonResult.compareStatus}
																side="left"
															/>
														{:else}
															<div class="text-sm text-gray-600 dark:text-gray-400">
																Loading comparison UI…
															</div>
														{/if}
													</div>
												</div>
												<div class="space-y-2 md:space-y-3">
													<h4
														class="border-b border-gray-200 pb-2 text-xs font-semibold text-gray-700 md:text-sm dark:border-gray-700 dark:text-gray-300"
													>
														{compareVersion}
													</h4>
													<div
														class="overflow-x-auto rounded-lg bg-gray-50 p-2 md:p-3 dark:bg-gray-900"
													>
														{#if DiffRender}
															<svelte:component
																this={DiffRender}
																hash=""
																source="eda"
																type="status"
																leftData={status}
																rightData={comparisonResult.compareStatus}
																side="right"
															/>
														{:else}
															<div class="text-sm text-gray-600 dark:text-gray-400">
																Loading comparison UI…
															</div>
														{/if}
													</div>
												</div>
											</div>
										</div>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</main>
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<PageCredits />
			</div>
		</div>
	</div>
{/key}
