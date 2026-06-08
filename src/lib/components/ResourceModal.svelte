<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';

	import Render from '$lib/components/Render.svelte';
	import ResourceViewTabs from '$lib/components/ResourceViewTabs.svelte';
	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import { compareVersionDesc, getLatestVersion } from '$lib/versions';
	import { fetchVersionsForResource } from '$lib/manifest';
	import type { CrdResource, CrdVersions, EdaRelease, ReleasesConfig } from '$lib/structure';
	import releasesYaml from '$lib/releases.yaml?raw';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

	let DiffRender: typeof import('$lib/components/DiffRender.svelte').default | null = null;

	function portal(node: HTMLElement) {
		if (!browser) return { destroy() {} };
		document.body.appendChild(node);
		return {
			destroy() {
				try {
					node.parentNode?.removeChild(node);
				} catch {
					/* ignore */
				}
			}
		};
	}

	export let open = false;
	export let resourceDef: CrdResource | null = null;
	export let selectedRelease: EdaRelease;
	export let allReleases: EdaRelease[] = [];
	/** When set, opens the modal on this API version instead of the latest. */
	export let initialVersion: string | null = null;
	/** Optional path highlights (e.g. from spec search). */
	export let highlightPaths: string[] = [];
	/** Optional pre-marked schema trees for highlighted display. */
	export let displaySpec: unknown = null;
	export let displayStatus: unknown = null;
	export let onClose: () => void = () => {};

	let loading = false;
	let error: string | null = null;
	let spec: any = null;
	let status: any = null;
	let kind = '';
	let group = '';
	let name = '';
	let versionOnFocus = '';
	let deprecated = false;

	let viewMode: 'schema' | 'compare' = 'schema';
	let specExpanded = true;
	let statusExpanded = true;

	let compareVersion: string | null = null;
	let compareRelease: string | null = null;
	let comparisonResult: any = null;
	let isComparing = false;
	let compareReleaseVersions: string[] = [];
	let validVersions: string[] = [];
	let versionDeprecated: Record<string, boolean> = {};
	let compareVersionDeprecated: Record<string, boolean> = {};
	let latestVersion = '';
	let compareVersionsRequestId = 0;
	let deprecatedSince: string | null = null;
	let deprecatedSinceRequestId = 0;

	const modalTitleId = 'resource-modal-title';
	let loadedKey = '';

	$: if (open && resourceDef) {
		const versionsKey = (resourceDef.versions ?? []).map((v) => v.name).join(',');
		const key = `${resourceDef.name}@${selectedRelease.name}@${initialVersion ?? ''}@${versionsKey}`;
		if (key !== loadedKey) {
			loadedKey = key;
			loadResource(resourceDef, selectedRelease);
		}
	}

	$: if (!open) {
		loadedKey = '';
		resetState();
	}

	$: if (name && compareRelease && compareRelease !== selectedRelease.name) {
		loadVersionsForCompareRelease(compareRelease, name);
	} else {
		compareReleaseVersions = validVersions;
		compareVersionDeprecated = versionDeprecated;
	}

	$: if (compareVersion || compareRelease) {
		handleVersionChange();
	}

	$: if (viewMode === 'compare' && !DiffRender && browser) {
		import('$lib/components/DiffRender.svelte').then((m) => {
			DiffRender = m.default;
		});
	}

	function resetState() {
		loading = false;
		error = null;
		spec = null;
		status = null;
		viewMode = 'schema';
		specExpanded = true;
		statusExpanded = true;
		compareVersion = null;
		compareRelease = null;
		comparisonResult = null;
		isComparing = false;
		compareReleaseVersions = [];
		validVersions = [];
		versionDeprecated = {};
		compareVersionDeprecated = {};
		latestVersion = '';
		deprecatedSince = null;
		expandAll.set(false);
		expandAllScope.set('local');
		ulExpanded.set([]);
	}

	function applyVersionMetadata(versions: CrdVersions[]) {
		validVersions = versions.map((v) => v.name).sort(compareVersionDesc);
		versionDeprecated = Object.fromEntries(versions.map((v) => [v.name, !!v.deprecated]));
		compareReleaseVersions = [...validVersions];
		compareVersionDeprecated = { ...versionDeprecated };
		latestVersion = getLatestVersion(versions);
	}

	function versionLabel(version: string) {
		const parts = [version];
		if (version === latestVersion) parts.push('(latest)');
		if (versionDeprecated[version]) parts.push('(deprecated)');
		return parts.join(' ');
	}

	function compareVersionLabel(version: string) {
		if (compareVersionDeprecated[version]) return `${version} (deprecated)`;
		return version;
	}

	function getReleaseList(): EdaRelease[] {
		return allReleases.length > 0 ? allReleases : releasesConfig.releases;
	}

	async function computeDeprecatedSince(
		resourceName: string,
		version: string,
		isDeprecated: boolean
	) {
		deprecatedSince = null;
		if (!isDeprecated || !resourceName || !version) return;

		const requestId = ++deprecatedSinceRequestId;
		const sortedReleases = getReleaseList().slice().reverse();

		const { fetchManifest } = await import('$lib/manifest');
		for (const r of sortedReleases) {
			try {
				const manifest = await fetchManifest(r.folder);
				if (!manifest) continue;
				const entry = manifest.find((x) => x.name === resourceName);
				if (!entry?.versions) continue;
				const v = entry.versions.find((vv: { name: string }) => vv.name === version);
				if (v?.deprecated) {
					if (requestId === deprecatedSinceRequestId) {
						deprecatedSince = r.label || r.name;
					}
					return;
				}
			} catch {
				/* ignore */
			}
		}

		if (requestId === deprecatedSinceRequestId) {
			deprecatedSince = selectedRelease.label || selectedRelease.name || null;
		}
	}

	$: if (open && name && versionOnFocus) {
		if (deprecated) {
			void computeDeprecatedSince(name, versionOnFocus, true);
		} else {
			deprecatedSince = null;
		}
	}

	async function loadVersionYaml(version: string, release: EdaRelease) {
		loading = true;
		error = null;
		spec = null;
		status = null;

		try {
			const response = await fetch(`/${release.folder}/${name}/${version}.yaml`);
			if (!response.ok) throw new Error('Failed to load resource');
			const yamlText = await response.text();
			const data = loadStaticYaml(yamlText) as any;
			spec = data?.schema?.openAPIV3Schema?.properties?.spec ?? null;
			status = data?.schema?.openAPIV3Schema?.properties?.status ?? null;
		} catch {
			error = 'Failed to load resource schema';
			spec = null;
			status = null;
		} finally {
			loading = false;
		}
	}

	async function loadResource(res: CrdResource, release: EdaRelease) {
		const versions = await fetchVersionsForResource(res.name, release, res.versions ?? []);
		const versionNames = versions.map((v) => v.name);
		const version =
			initialVersion && versionNames.includes(initialVersion)
				? initialVersion
				: getLatestVersion(versions);
		if (!version) {
			error = 'No version available for this resource';
			return;
		}

		name = res.name;
		kind = res.kind || res.name.split('.')[0];
		group = res.group || res.name.split('.').slice(1).join('.');
		applyVersionMetadata(versions);
		versionOnFocus = version;
		deprecated = !!versionDeprecated[version];
		compareVersion = null;
		compareRelease = null;
		comparisonResult = null;
		viewMode = 'schema';
		expandAll.set(false);
		expandAllScope.set('local');
		ulExpanded.set([]);

		await loadVersionYaml(version, release);
	}

	async function handleModalVersionChange() {
		const newVersion = versionOnFocus;
		if (!newVersion) return;

		deprecated = !!versionDeprecated[newVersion];
		compareVersion = null;
		comparisonResult = null;
		await loadVersionYaml(newVersion, selectedRelease);
	}

	async function loadVersionsForCompareRelease(releaseName: string, resourceName: string) {
		if (!resourceName) return;

		const requestId = ++compareVersionsRequestId;
		try {
			const release = allReleases.find((r) => r.name === releaseName);
			if (!release) {
				if (requestId === compareVersionsRequestId) {
					compareReleaseVersions = [];
					compareVersionDeprecated = {};
				}
				return;
			}
			const versions = await fetchVersionsForResource(resourceName, release);
			if (versions.length > 0) {
				if (requestId === compareVersionsRequestId) {
					compareReleaseVersions = versions.map((v) => v.name).sort(compareVersionDesc);
					compareVersionDeprecated = Object.fromEntries(
						versions.map((v) => [v.name, !!v.deprecated])
					);
				}
				return;
			}
		} catch {
			/* ignore */
		}
		if (requestId === compareVersionsRequestId) {
			compareReleaseVersions = [];
			compareVersionDeprecated = {};
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
			let fetchFolder = selectedRelease.folder;
			if (compareRelease) {
				const rel = allReleases.find((r) => r.name === compareRelease);
				if (rel) fetchFolder = rel.folder;
			}

			let response = await fetch(`/${fetchFolder}/${name}/${compareVersion}.yaml`);
			if (!response.ok) {
				response = await fetch(`/resources/${name}/${compareVersion}.yaml`);
			}
			if (!response.ok) {
				isComparing = false;
				return;
			}

			const crdText = await response.text();
			const crd = loadStaticYaml(crdText) as any;
			const compareSpec = crd?.schema?.openAPIV3Schema?.properties?.spec;
			const compareStatus = crd?.schema?.openAPIV3Schema?.properties?.status;

			comparisonResult = {
				baseVersion: versionOnFocus,
				compareVersion,
				baseRelease: selectedRelease.label,
				compareRelease: compareRelease
					? allReleases.find((r) => r.name === compareRelease)?.label
					: selectedRelease.label,
				compareSpec,
				compareStatus
			};
		} catch {
			/* ignore */
		}

		isComparing = false;
	}

	function handleGlobalExpand() {
		expandAllScope.set('global');
		if ($ulExpanded.length > 0) {
			expandAll.set(false);
		} else {
			expandAll.set(true);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			onClose();
		}
	}

	function setBodyScrollLock(locked: boolean) {
		if (!browser) return;
		document.documentElement.classList.toggle('no-root-scroll', locked);
		document.body.classList.toggle('no-root-scroll', locked);
	}

	$: setBodyScrollLock(open);

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		setBodyScrollLock(false);
	});

</script>

{#if open && resourceDef}
	<div use:portal class="resource-modal-portal fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
		<!-- Backdrop -->
		<button
			type="button"
			class="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
			on:click={onClose}
			aria-label="Close modal"
			tabindex={-1}
		></button>

		<!-- Panel -->
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={modalTitleId}
			class="resource-modal-panel relative flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-white shadow-2xl md:h-auto md:max-h-[90vh] md:max-w-6xl md:rounded-xl dark:bg-slate-900"
		>
			<!-- Sticky header -->
			<header
				class="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
			>
				<div class="flex items-start justify-between gap-3 px-3 py-3 sm:px-4">
					<div class="min-w-0 flex-1">
						<div class="flex items-start justify-between gap-3">
							<h2
								id={modalTitleId}
								class="min-w-0 truncate text-base font-semibold text-slate-900 sm:text-lg dark:text-white"
							>
								{kind}
							</h2>
							<div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
								{#if validVersions.length > 1}
									<select
										class="min-h-11 min-w-[5.5rem] rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-sm font-medium text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-500 dark:bg-slate-800 dark:text-white"
										bind:value={versionOnFocus}
										on:change={handleModalVersionChange}
										aria-label="Select resource version"
									>
										{#each validVersions as version}
											<option value={version}>{versionLabel(version)}</option>
										{/each}
									</select>
								{:else if versionOnFocus}
									<span
										class="inline-flex min-h-11 items-center rounded-lg bg-slate-100 px-2.5 py-2 font-mono text-sm font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
									>
										{versionOnFocus}
									</span>
								{/if}
								<span
									class="inline-flex min-h-11 max-w-[10rem] items-center truncate rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
								>
									{selectedRelease.label}
								</span>
							</div>
						</div>
						<p class="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
							{group}
						</p>
						{#if deprecated}
							<div class="mt-1.5">
								<span
									class="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-orange-700 sm:text-xs dark:bg-orange-900/30 dark:text-orange-400"
									title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : 'Deprecated'}
								>
									DEPRECATED{#if deprecatedSince}<span class="font-normal opacity-80"> · {deprecatedSince}</span>{/if}
								</span>
							</div>
						{/if}
					</div>
					<button
						type="button"
						on:click={onClose}
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="border-t border-slate-100 px-3 py-2 sm:px-4 dark:border-slate-800">
					<ResourceViewTabs
						{viewMode}
						onViewChange={(mode) => (viewMode = mode)}
						showExpandControls={viewMode === 'schema'}
						isExpanded={$ulExpanded.length > 0}
						onExpandToggle={handleGlobalExpand}
					/>
				</div>
			</header>

			<!-- Scrollable body -->
			<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
				{#if loading}
					<div class="flex items-center justify-center py-16">
						<div
							class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400"
						></div>
					</div>
				{:else if error}
					<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				{:else if viewMode === 'schema'}
					<div class="space-y-3">
						<section
							class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
						>
							<button
								type="button"
								class="flex min-h-11 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
								on:click={() => (specExpanded = !specExpanded)}
								aria-expanded={specExpanded}
							>
								<div>
									<h3 class="text-sm font-semibold text-slate-900 dark:text-white">Specification</h3>
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
							{#if specExpanded && (displaySpec || spec)}
								<div class="overflow-x-auto px-3 py-3 text-sm sm:p-4">
									<Render
										hash={highlightPaths.join('|')}
										source="eda"
										type="spec"
										data={displaySpec ?? spec}
										showType={false}
										showDiffIndicator={highlightPaths.length > 0}
										onResourcePage={true}
										resourceName={name}
										resourceVersion={versionOnFocus}
										releaseName={selectedRelease.name}
									/>
								</div>
							{:else if specExpanded}
								<p class="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No specification schema available.</p>
							{/if}
						</section>

						<section
							class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
						>
							<button
								type="button"
								class="flex min-h-11 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
								on:click={() => (statusExpanded = !statusExpanded)}
								aria-expanded={statusExpanded}
							>
								<div>
									<h3 class="text-sm font-semibold text-slate-900 dark:text-white">Status</h3>
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
							{#if statusExpanded && (displayStatus || status)}
								<div class="overflow-x-auto px-3 py-3 text-sm sm:p-4">
									<Render
										hash={highlightPaths.join('|')}
										source="eda"
										type="status"
										data={displayStatus ?? status}
										showType={false}
										showDiffIndicator={highlightPaths.length > 0}
										onResourcePage={true}
										resourceName={name}
										resourceVersion={versionOnFocus}
										releaseName={selectedRelease.name}
									/>
								</div>
							{:else if statusExpanded}
								<p class="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No status schema available.</p>
							{/if}
						</section>
					</div>
				{:else}
					<!-- Compare view -->
					<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88">
						<div class="border-b border-slate-200 px-3 py-4 sm:px-4 dark:border-slate-700">
							<h3 class="text-sm font-semibold text-slate-900 dark:text-white">Schema comparison</h3>
							<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
								Compare {versionOnFocus} against another release or version
							</p>
							<div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
								<div class="min-w-0 flex-1">
									<label for="modal-compare-release" class="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">
										Release
									</label>
									<select
										id="modal-compare-release"
										bind:value={compareRelease}
										on:change={() => {
											compareVersion = null;
										}}
										class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
									>
										<option value="">Current ({selectedRelease.label})</option>
										{#each allReleases as release}
											<option value={release.name}>{release.label}</option>
										{/each}
									</select>
								</div>
								<div class="min-w-0 flex-1">
									<label for="modal-compare-version" class="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">
										Version
									</label>
									<select
										id="modal-compare-version"
										bind:value={compareVersion}
										class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
										disabled={compareReleaseVersions.length === 0}
									>
										<option value="">Select version</option>
										{#each compareReleaseVersions as version}
											<option value={version}>{compareVersionLabel(version)}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<div class="p-3 sm:p-4">
							{#if !compareVersion}
								<div class="flex flex-col items-center justify-center py-10 text-center">
									<svg class="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
									</svg>
									<p class="text-sm font-medium text-slate-700 dark:text-slate-300">Select a version to compare</p>
									<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Current: {versionOnFocus} ({selectedRelease.label})</p>
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
											<h4 class="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{section.title}</h4>
											<div class="grid gap-4 md:grid-cols-2">
												{#each [{ label: versionOnFocus, side: 'left' }, { label: compareVersion, side: 'right' }] as col}
													<div class="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700">
														<div class="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
															<span class="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">{col.label}</span>
														</div>
														<div class="overflow-x-auto p-3 text-sm">
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
		</div>
	</div>
{/if}
