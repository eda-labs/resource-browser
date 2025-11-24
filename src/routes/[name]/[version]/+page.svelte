<script lang="ts">
	import { page } from '$app/stores';
	import { derived, writable } from 'svelte/store';
	import { onMount, onDestroy } from 'svelte';
	// Ajv and js-yaml are used only by validation flow; load dynamically to reduce initial bundle
	import type { ErrorObject } from 'ajv';

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
	let viewMode: 'schema' | 'compare' | 'validate' = 'schema';

	let yamlInput = '';
	let validationErrors: ErrorObject[] = [];
	let isValidating = false;
	let validationResult: 'valid' | 'invalid' | null = null;

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

	async function validateYaml() {
		const [{ default: Ajv }] = await Promise.all([import('ajv')]);
		const yamlLib = (await import('js-yaml')).default;
		if (!yamlInput.trim()) {
			validationErrors = [];
			validationResult = null;
			return;
		}

		isValidating = true;
		validationErrors = [];
		validationResult = null;

		try {
			const yamlDocs = yamlInput.split(/^---$/m).filter((doc) => doc.trim());
			const parsedDocs: any[] = [];

			for (const doc of yamlDocs) {
				try {
					const parsed = yamlLib.load(doc.trim());
					if (parsed) {
						parsedDocs.push(parsed);
					}
				} catch (e) {
					const allDocs = yamlLib.loadAll(doc.trim());
					parsedDocs.push(...allDocs.filter((d) => d !== null && d !== undefined));
				}
			}

			if (parsedDocs.length === 0) {
				const allDocs = yamlLib.loadAll(yamlInput);
				parsedDocs.push(...allDocs.filter((d) => d !== null && d !== undefined));
			}

			if (parsedDocs.length === 0) {
				validationErrors = [
					{
						message: 'No valid YAML documents found',
						instancePath: '',
						schemaPath: '',
						keyword: 'format',
						params: {}
					} as ErrorObject
				];
				validationResult = 'invalid';
				isValidating = false;
				return;
			}

			if (!spec || !spec.properties) {
				validationErrors = [
					{
						message: 'No schema found in CRD for validation',
						instancePath: '',
						schemaPath: '',
						keyword: 'schema',
						params: {}
					} as ErrorObject
				];
				validationResult = 'invalid';
				isValidating = false;
				return;
			}

			const ajv = new Ajv({
				allErrors: true,
				verbose: true,
				strict: false,
				validateFormats: false
			});

			let valid = true;
			const errors: ErrorObject[] = [];

			parsedDocs.forEach((parsedYaml, index) => {
				const docPrefix = parsedDocs.length > 1 ? `[Document ${index + 1}] ` : '';

				if (parsedYaml.spec && spec.properties.spec) {
					const specValidator = ajv.compile(spec.properties.spec);
					if (!specValidator(parsedYaml.spec)) {
						valid = false;
						const docErrors = (specValidator.errors || []).map((err) => ({
							...err,
							message: `${docPrefix}${err.message}`
						}));
						errors.push(...docErrors);
					}
				} else if (!parsedYaml.spec && spec.properties.spec) {
					errors.push({
						message: `${docPrefix}Missing required 'spec' field`,
						instancePath: '',
						schemaPath: '',
						keyword: 'required',
						params: { missingProperty: 'spec' }
					} as ErrorObject);
					valid = false;
				}

				if (parsedYaml.status && status && status.properties) {
					const statusValidator = ajv.compile(status);
					if (!statusValidator(parsedYaml.status)) {
						valid = false;
						const docErrors = (statusValidator.errors || []).map((err) => ({
							...err,
							message: `${docPrefix}${err.message}`
						}));
						errors.push(...docErrors);
					}
				}
			});

			if (valid) {
				validationResult = 'valid';
				if (parsedDocs.length > 1) {
					validationErrors = [
						{
							message: `✓ Successfully validated ${parsedDocs.length} YAML documents`,
							instancePath: '',
							schemaPath: '',
							keyword: 'success',
							params: {}
						} as ErrorObject
					];
				}
			} else {
				validationErrors = errors;
				validationResult = 'invalid';
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			validationErrors = [
				{
					message: `YAML parsing error: ${errorMessage}`,
					instancePath: '',
					schemaPath: '',
					keyword: 'format',
					params: {}
				} as ErrorObject
			];
			validationResult = 'invalid';
		}

		isValidating = false;
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
		yamlInput = '';
		validationResult = null;
		validationErrors = [];
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

	<div class="relative flex min-h-screen flex-col overflow-hidden pt-16 md:pt-20">
		<div class="relative flex-1">
			<main class="flex-1 px-4 pt-4 pb-10 md:px-8 md:pt-6 lg:px-12">
				<div class="mx-auto w-full max-w-7xl">
					<!-- Unified Control Panel -->
					<div
						class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg backdrop-blur-sm md:mb-8 md:rounded-xl dark:border-gray-700/60 dark:bg-gray-800/90 dark:shadow-2xl"
					>
						<!-- Control Bar - Responsive Layout -->
						<div
							class="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 md:px-6 md:py-4 dark:from-gray-800/50 dark:to-gray-900/50"
						>
							<div
								class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-4"
							>
								<!-- Left: View Mode Buttons - Stacked on mobile -->
								<div
									class="inline-flex flex-wrap items-center gap-1 overflow-y-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-inner md:gap-2 md:overflow-x-auto md:rounded-xl md:p-1.5 dark:border-gray-700 dark:bg-gray-900/50"
								>
									<button
										on:click={() => (viewMode = 'schema')}
										class="group relative inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold whitespace-normal transition-all duration-300 md:flex-shrink-0 md:gap-2 md:px-5 md:py-2.5 md:text-sm md:whitespace-nowrap {viewMode ===
										'schema'
											? 'scale-105 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30'
											: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'}"
									>
										<svg
											class="h-3.5 w-3.5 transition-transform group-hover:scale-110 md:h-4 md:w-4"
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
										<span class="hidden sm:inline">Schema</span>
										{#if viewMode === 'schema'}
											<span
												class="absolute -bottom-2 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600 to-blue-700 md:w-12"
											></span>
										{/if}
									</button>
									<button
										on:click={() => (viewMode = 'compare')}
										class="group relative inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold whitespace-normal transition-all duration-300 md:flex-shrink-0 md:gap-2 md:px-5 md:py-2.5 md:text-sm md:whitespace-nowrap {viewMode ===
										'compare'
											? 'scale-105 bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/30'
											: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'}"
									>
										<svg
											class="h-3.5 w-3.5 transition-transform group-hover:scale-110 md:h-4 md:w-4"
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
										<span class="hidden sm:inline">Compare</span>
										{#if viewMode === 'compare'}
											<span
												class="absolute -bottom-2 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-gradient-to-r from-orange-600 to-amber-600 md:w-12"
											></span>
										{/if}
									</button>
									<button
										on:click={() => (viewMode = 'validate')}
										class="group relative inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold whitespace-normal transition-all duration-300 md:flex-shrink-0 md:gap-2 md:px-5 md:py-2.5 md:text-sm md:whitespace-nowrap {viewMode ===
										'validate'
											? 'scale-105 bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
											: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'}"
									>
										<svg
											class="h-3.5 w-3.5 transition-transform group-hover:scale-110 md:h-4 md:w-4"
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
										<span class="hidden sm:inline">Validate</span>
										{#if viewMode === 'validate'}
											<span
												class="absolute -bottom-2 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 md:w-12"
											></span>
										{/if}
									</button>
								</div>

								<!-- Right: Action Controls - Full width on mobile -->
								<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
									<!-- Expand/Collapse Button -->
									<button
										class="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-xs font-semibold shadow-sm transition-all duration-300
									       hover:shadow-md focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none sm:w-auto md:rounded-xl md:px-5 md:py-2.5 md:text-sm
									       {$ulExpanded.length > 0
											? 'border-gray-300 bg-gradient-to-br from-white to-gray-50 text-gray-700 hover:from-gray-50 hover:to-gray-100 dark:border-gray-600 dark:from-gray-800 dark:to-gray-900 dark:text-gray-300 dark:hover:from-gray-700 dark:hover:to-gray-800'
											: 'border-blue-500 bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-blue-500/20 hover:from-blue-700 hover:to-blue-800 dark:shadow-blue-500/30'}"
										on:click={handleGlobalExpand}
									>
										<svg
											class="h-3.5 w-3.5 transition-transform duration-300 md:h-4 md:w-4 {$ulExpanded.length >
											0
												? 'rotate-0'
												: 'rotate-90'}"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											{#if $ulExpanded.length > 0}
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2.5"
													d="M5 15l7-7 7 7"
												/>
											{:else}
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2.5"
													d="M19 9l-7 7-7-7"
												/>
											{/if}
										</svg>
										<span class="text-xs md:text-sm"
											>{$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} All</span
										>
									</button>
								</div>
							</div>
						</div>
					</div>

					<!-- Schema Section -->
					{#if viewMode === 'schema'}
						<div class="content-header mb-8 space-y-6 md:mb-10 md:space-y-8">
							<!-- Specification Section -->
							<div
								class="overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-sm backdrop-blur-lg md:rounded-xl"
							>
								<div
									class="content-header border-b border-white/10 bg-black/20 px-4 py-4 md:px-8 md:py-6"
								>
									<div class="flex items-center space-x-3 md:space-x-4">
										<div
											class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-xl md:h-12 md:w-12 md:rounded-xl"
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
													d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
										</div>
										<div class="min-w-0">
											<h2 class="text-lg font-semibold text-white md:text-2xl">Specification</h2>
											<p class="mt-0.5 text-xs text-gray-300 md:text-sm">
												Required configuration fields
											</p>
										</div>
									</div>
								</div>
								<div class="overflow-x-auto bg-black/10 p-4 md:p-8">
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
								class="overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-sm backdrop-blur-lg md:rounded-xl"
							>
								<div
									class="content-header border-b border-white/10 bg-black/20 px-4 py-4 md:px-8 md:py-6"
								>
									<div class="flex items-center space-x-3 md:space-x-4">
										<div
											class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-xl md:h-12 md:w-12 md:rounded-xl"
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
													d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
										</div>
										<div class="min-w-0">
											<h2 class="text-lg font-semibold text-white md:text-2xl">Status</h2>
											<p class="mt-0.5 text-xs text-gray-300 md:text-sm">Runtime status fields</p>
										</div>
									</div>
								</div>
								<div class="overflow-x-auto bg-black/10 p-4 md:p-8">
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

					<!-- Validation Section -->
					{#if viewMode === 'validate'}
						<div
							class="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:mt-10 md:rounded-xl dark:border-gray-700/60 dark:bg-gray-800/90 dark:shadow-xl"
						>
							<div
								class="border-b border-gray-200 bg-gray-50 px-4 py-4 md:px-8 md:py-6 dark:border-gray-700 dark:bg-gray-800"
							>
								<div class="flex items-center space-x-3 md:space-x-4">
									<div
										class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-xl md:h-12 md:w-12 md:rounded-xl"
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
												d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
											/>
										</svg>
									</div>
									<div class="min-w-0">
										<h2 class="text-lg font-semibold text-gray-900 md:text-2xl dark:text-white">
											YAML Validation
										</h2>
										<p class="mt-0.5 text-xs text-gray-600 md:text-sm dark:text-gray-300">
											Validate YAML against CRD schema
										</p>
									</div>
								</div>
							</div>
							<div class="bg-white p-4 md:p-8 dark:bg-gray-800">
								<div class="space-y-4 md:space-y-6">
									<!-- Instructions -->
									<div
										class="rounded-lg border border-blue-200 bg-blue-50 p-3 md:p-4 dark:border-blue-800 dark:bg-blue-900/20"
									>
										<div class="flex items-start space-x-2 md:space-x-3">
											<svg
												class="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 md:h-5 md:w-5 dark:text-blue-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
											<div class="text-xs text-blue-800 md:text-sm dark:text-blue-200">
												<p class="mb-1 font-medium">How to use:</p>
												<ul
													class="list-inside list-disc space-y-0.5 text-blue-700 dark:text-blue-300"
												>
													<li>Paste your complete YAML manifest</li>
													<li>
														Or paste just the <code
															class="rounded bg-blue-100 px-1 text-xs dark:bg-blue-800">spec</code
														> section
													</li>
													<li>
														Supports multiple documents separated by <code
															class="rounded bg-blue-100 px-1 text-xs dark:bg-blue-800">---</code
														>
													</li>
												</ul>
											</div>
										</div>
									</div>

									<!-- YAML Input -->
									<div>
										<label
											for="yaml-input"
											class="mb-2 block text-xs font-medium text-gray-700 md:text-sm dark:text-gray-300"
										>
											YAML Configuration
										</label>
										<textarea
											id="yaml-input"
											bind:value={yamlInput}
											placeholder={`apiVersion: ${group}/${versionOnFocus}\nkind: ${kind}\nmetadata:\n  name: example\nspec:`}
											rows="12"
											class="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder-gray-500 transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none md:px-4 md:py-3 md:text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
										></textarea>
									</div>

									<!-- Validate Button -->
									<div
										class="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4"
									>
										<button
											on:click={validateYaml}
											disabled={isValidating}
											class="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:from-purple-700 hover:to-indigo-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:rounded-xl md:px-6 md:py-3 md:text-sm"
										>
											{#if isValidating}
												<svg
													class="h-3.5 w-3.5 animate-spin md:h-4 md:w-4"
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
												<span>Validating...</span>
											{:else}
												<svg
													class="h-3.5 w-3.5 md:h-4 md:w-4"
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
												<span>Validate</span>
											{/if}
										</button>

										{#if validationResult}
											<div class="flex items-center justify-center gap-2">
												{#if validationResult === 'valid'}
													<div class="flex items-center gap-2 text-green-600 dark:text-green-400">
														<svg
															class="h-4 w-4"
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
														<span class="text-xs font-medium md:text-sm">Valid</span>
													</div>
												{:else}
													<div class="flex items-center gap-2 text-red-600 dark:text-red-400">
														<svg
															class="h-4 w-4"
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
														<span class="text-xs font-medium md:text-sm">Invalid</span>
													</div>
												{/if}
											</div>
										{/if}
									</div>

									<!-- Validation Results -->
									{#if validationErrors.length > 0}
										{#if validationResult === 'valid'}
											<div
												class="rounded-lg border border-green-200 bg-green-50 p-3 md:p-4 dark:border-green-800 dark:bg-green-900/20"
											>
												<div class="flex items-start gap-2 md:gap-3">
													<svg
														class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 md:h-5 md:w-5 dark:text-green-400"
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
													<p
														class="text-xs font-medium text-green-800 md:text-sm dark:text-green-200"
													>
														{validationErrors[0].message}
													</p>
												</div>
											</div>
										{:else}
											<div
												class="rounded-lg border border-red-200 bg-red-50 p-3 md:p-4 dark:border-red-800 dark:bg-red-900/20"
											>
												<div class="flex items-start gap-2 md:gap-3">
													<svg
														class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 md:h-5 md:w-5 dark:text-red-400"
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
													<div class="min-w-0 flex-1">
														<h4
															class="mb-2 text-xs font-medium text-red-800 md:text-sm dark:text-red-200"
														>
															Errors ({validationErrors.length})
														</h4>
														<ul class="space-y-1.5">
															{#each validationErrors as error}
																<li class="text-xs text-red-700 md:text-sm dark:text-red-300">
																	<div
																		class="overflow-x-auto rounded bg-red-100 p-2 font-mono text-xs dark:bg-red-900/30"
																	>
																		{#if (error as any).instancePath || (error as any).dataPath}
																			<span class="font-semibold"
																				>{(error as any).instancePath ||
																					(error as any).dataPath}</span
																			>:
																		{/if}
																		{error.message}
																	</div>
																</li>
															{/each}
														</ul>
													</div>
												</div>
											</div>
										{/if}
									{/if}
								</div>
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
