<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	import PageCredits from '$lib/components/PageCredits.svelte';
	import TopHeader from '$lib/components/TopHeader.svelte';
	import ResourceDetailHeader from '$lib/components/ResourceDetailHeader.svelte';
	import ResourceViewTabs from '$lib/components/ResourceViewTabs.svelte';
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
	let specExpanded = true;
	let statusExpanded = true;

	$: versionDeprecated = (() => {
		const entry = releaseManifest?.find((r: { name: string }) => r.name === name);
		const map: Record<string, boolean> = {};
		if (entry?.versions) {
			for (const v of entry.versions) {
				map[v.name] = !!v.deprecated;
			}
		}
		return map;
	})();

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
	<meta
		name="description"
		content="View the CRD definition, spec and status schema for {name} {versionOnFocus} in the Nokia EDA Resource Browser."
	/>
	<meta name="robots" content="index, follow" />
	<link rel="canonical" href="{$page.url.href}" />
</svelte:head>

{#key `${name}-${versionOnFocus}`}
	<TopHeader
		{name}
		{versionOnFocus}
		{validVersions}
		{versionDeprecated}
		{releaseLabel}
	/>

	<div class="page-shell relative flex min-h-full flex-col text-gray-900 dark:text-gray-100">
		<main class="flex-1 px-3 pt-2 pb-8 sm:px-3 sm:pt-3 md:px-4 md:pt-4">
			<div class="mx-auto w-full max-w-7xl space-y-3">
				<ResourceDetailHeader
					{kind}
					{group}
					{name}
					{versionOnFocus}
					{releaseLabel}
					{deprecated}
					deprecatedSince={clientDeprecatedSince}
				/>

				<div class="py-1">
					<ResourceViewTabs
						{viewMode}
						onViewChange={(mode) => (viewMode = mode)}
						showExpandControls={viewMode === 'schema'}
						isExpanded={$ulExpanded.length > 0}
						onExpandToggle={handleGlobalExpand}
					/>
				</div>

				<!-- Schema view -->
				{#if viewMode === 'schema'}
					<div class="space-y-3">
						<section
							class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
						>
							<button
								type="button"
								class="flex min-h-11 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
								on:click={() => (specExpanded = !specExpanded)}
								aria-expanded={specExpanded}
							>
								<div>
									<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Specification</h2>
									<p class="text-xs text-slate-500 dark:text-slate-400">Required configuration fields</p>
								</div>
								<svg
									class="h-4 w-4 shrink-0 text-slate-400 transition-transform {specExpanded ? 'rotate-180' : ''}"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
								</svg>
							</button>
							{#if specExpanded}
								<div class="overflow-x-auto px-3 py-4 sm:p-5">
									<Render {hash} source="eda" type="spec" data={spec} showType={false} onResourcePage={true} />
								</div>
							{/if}
						</section>

						<section
							class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
						>
							<button
								type="button"
								class="flex min-h-11 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
								on:click={() => (statusExpanded = !statusExpanded)}
								aria-expanded={statusExpanded}
							>
								<div>
									<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Status</h2>
									<p class="text-xs text-slate-500 dark:text-slate-400">Runtime status fields</p>
								</div>
								<svg
									class="h-4 w-4 shrink-0 text-slate-400 transition-transform {statusExpanded ? 'rotate-180' : ''}"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
								</svg>
							</button>
							{#if statusExpanded}
								<div class="overflow-x-auto px-3 py-4 sm:p-5">
									<Render {hash} source="eda" type="status" data={status} showType={false} onResourcePage={true} />
								</div>
							{/if}
						</section>
					</div>
				{/if}

				<!-- Compare view -->
				{#if viewMode === 'compare'}
					<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88">
						<div class="border-b border-slate-200 px-4 py-4 sm:px-5 dark:border-slate-700">
							<h2 class="text-sm font-semibold text-slate-900 dark:text-white">Schema comparison</h2>
							<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
								Compare {versionOnFocus} against another release or version
							</p>
							<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
								<div class="flex-1">
									<label for="compare-release-select" class="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">
										Release
									</label>
									<select
										id="compare-release-select"
										bind:value={compareRelease}
										on:change={() => {
											compareVersion = null;
										}}
										class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
									>
										{#each allReleases as release}
											<option value={release.name}>{release.label}</option>
										{/each}
									</select>
								</div>
								<div class="flex-1">
									<label for="compare-version-select" class="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">
										Version
									</label>
									<select
										id="compare-version-select"
										bind:value={compareVersion}
										class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
										disabled={compareReleaseVersions.length === 0}
										aria-label="Select version to compare"
									>
										<option value="">Select version</option>
										{#each compareReleaseVersions as version}
											<option value={version}>{version}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<div class="p-4 sm:p-5">
							{#if !compareVersion}
								<div class="flex flex-col items-center justify-center py-10 text-center">
									<svg class="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
									</svg>
									<p class="text-sm font-medium text-slate-700 dark:text-slate-300">Select a version to compare</p>
									<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Current: {versionOnFocus} ({releaseLabel})</p>
								</div>
							{:else if isComparing}
								<div class="flex items-center justify-center py-10">
									<div class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400"></div>
								</div>
							{:else if comparisonResult}
								<div class="space-y-6">
									<div class="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/50">
										<span class="font-medium text-blue-700 dark:text-blue-300">{comparisonResult.baseRelease}</span>
										<span class="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-xs dark:bg-slate-700">{versionOnFocus}</span>
										<svg class="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
										</svg>
										<span class="font-medium text-blue-700 dark:text-blue-300">{comparisonResult.compareRelease}</span>
										<span class="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-xs dark:bg-slate-700">{compareVersion}</span>
									</div>

									{#each [{ title: 'Specification', type: 'spec', base: spec, compare: comparisonResult.compareSpec }, { title: 'Status', type: 'status', base: status, compare: comparisonResult.compareStatus }] as section}
										<div>
											<h3 class="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{section.title}</h3>
											<div class="grid gap-4 md:grid-cols-2">
												{#each [{ label: versionOnFocus, side: 'left' }, { label: compareVersion, side: 'right' }] as col}
													<div class="rounded-lg border border-slate-200 dark:border-slate-700">
														<div class="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
															<span class="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{col.label}</span>
														</div>
														<div class="overflow-x-auto p-3">
															{#if DiffRender}
																<svelte:component
																	this={DiffRender}
																	hash=""
																	source="eda"
																	type={section.type}
																	leftData={section.base}
																	rightData={section.compare}
																	side={col.side}
																/>
															{:else}
																<p class="text-sm text-slate-500 dark:text-slate-400">Loading comparison UI…</p>
															{/if}
														</div>
													</div>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</main>

		<div class="mx-auto w-full max-w-7xl px-3 pb-6 md:px-4">
			<PageCredits />
		</div>
	</div>
{/key}
