<script lang="ts">
	import { derived, writable } from 'svelte/store';
	import { onMount, onDestroy } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	// Ajv is used only for YAML validation; load dynamically to avoid increasing main bundle size

	import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import Render from '$lib/components/Render.svelte';
	import DiffRender from '$lib/components/DiffRender.svelte';
	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import type { CrdVersionsMap } from '$lib/structure';
	import yaml from 'js-yaml';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';
	
	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

// Mobile panel state for compact release list (declared later)

// Short Nokia EDA description (sourced from Nokia pages)
const nokiaEdaDescription = `The Nokia EDA Resource Browser helps you discover Nokia EDA Custom Resource Definitions (CRDs) across releases, providing the specification and status fields needed to manage resources in your EDA environment.

This browser makes it easier to find, validate and compare definitions for Nokia applications, helping developers and operators work with model-driven APIs and simplified tooling.`;
	const defaultRelease = releasesConfig.releases.find(r => r.default) || releasesConfig.releases[0];
	const crdMetaStore = writable<CrdResource[]>([]);
	const resourceSearch = writable('');
	const selectedRelease = writable<EdaRelease>(defaultRelease);
	const releaseFolder = derived(selectedRelease, $selectedRelease => $selectedRelease.folder);
	const resourceNameStore = derived(crdMetaStore, ($crdMetaStore) => $crdMetaStore.map((x) => x.name));
	const resourceSearchFilter = derived([resourceSearch, resourceNameStore], ([$resourceSearch, $resourceNameStore]) => {
		return $resourceNameStore.filter((x) => $resourceSearch.split(/\s+/).every((y) => x.includes(y.toLowerCase())));
	});

	// Group releases by major version (e.g., 25 -> v25)
	// Add a `showMore` property to each group for dropdown toggles.
	let groupedReleases = (() => {
		const groups: Record<string, any[]> = {};
		(releasesConfig.releases || []).forEach(r => {
			const major = String(r.name).split('.')[0];
			const label = `v${major}`;
			groups[label] = groups[label] || [];
			groups[label].push(r);
		});
		// sort groups by major desc
		return Object.entries(groups).sort((a,b) => parseInt(b[0].replace('v','')) - parseInt(a[0].replace('v',''))).map(([label, releases]) => ({ label, releases: releases.sort((a,b)=> b.name.localeCompare(a.name)), showMore: false }));
	})();

	let selectedResource: string | null = null;
	let selectedVersion: string | null = null;
	let resourceData: any = null;
	let loading = false;
	let showBrowseMode = false;
	let mobileMenuOpen = false;
	let mobileReleasesOpen = false;
	let showDiff = false;
	let compareVersion: string | null = null;
	let compareData: any = null;
	let viewMode: 'schema' | 'validate' = 'schema';
	let selectedCompareVersion: string | null = null;
	let showReleaseComparison = false;
	let compareRelease: EdaRelease | null = null;
	let compareReleaseData: any = null;
	let compareReleaseVersions: string[] = [];
    
	let mobileReleasesPanelEl: HTMLElement | null = null;
	let lastActiveElement: Element | null = null;
	let mobileTrapCleanup: (() => void) | null = null;
    
	let yamlInput = '';
	let validationErrors: any[] = [];
	let isValidating = false;
	let validationResult: 'valid' | 'invalid' | null = null;
	let releaseAvailability: Map<string, boolean> = new Map();
	
	$: currentResourceDef = selectedResource ? $crdMetaStore.find(x => x.name === selectedResource) : null;
	// Filter out CRDs that match the status filter and exclude 'states' CRDs from UI
    
	$: resourceInfo = resourceData ? { kind: resourceData.spec?.names?.kind || '', group: resourceData.spec?.group || '', name: selectedResource || '' } : null;
	$: if (selectedResource || selectedVersion) { releaseAvailability.clear(); }
	// Defer initial heavy manifest load until after paint to improve LCP (use requestIdleCallback where available)
	let initialLoaded = false;
	onMount(() => {
		if (typeof (window as any).requestIdleCallback === 'function') {
			(window as any).requestIdleCallback(() => { loadCrdsForRelease($selectedRelease); initialLoaded = true; });
		} else {
			setTimeout(() => { loadCrdsForRelease($selectedRelease); initialLoaded = true; }, 200);
		}
	});
	// After initial load, reactively reload when selectedRelease changes.
	$: if (initialLoaded) { loadCrdsForRelease($selectedRelease); selectedResource = null; selectedVersion = null; resourceData = null; }
	// When the selected release object changes, load versions and set version lists
	$: if (compareRelease && selectedResource) { loadVersionsForResourceInRelease(compareRelease, selectedResource).then(versions => { compareReleaseVersions = versions; }); } else { compareReleaseVersions = []; }
	$: updateRootScroll();
    

    

$: if (typeof window !== 'undefined') {
	if (mobileReleasesOpen) {
		document.documentElement.classList.add('no-root-scroll');
		document.body.classList.add('no-root-scroll');
		setTimeout(() => {
			if (mobileReleasesPanelEl) {
				if (mobileTrapCleanup) mobileTrapCleanup();
				mobileTrapCleanup = trapFocus(mobileReleasesPanelEl);
			}
		}, 0);
	} else {
		if (mobileTrapCleanup) { mobileTrapCleanup(); mobileTrapCleanup = null; }
		document.documentElement.classList.remove('no-root-scroll');
		document.body.classList.remove('no-root-scroll');
	}
}

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.documentElement.classList.remove('no-root-scroll');
			document.body.classList.remove('no-root-scroll');
		}
	});

	function formatResourceName(name: string): string { return name.split('.')[0] || name; }
	function formatGroupName(name: string): string { return name.split('.').slice(1).join('.') || name; }
	function updateRootScroll() {
		if (typeof window === 'undefined') return;
		try {
			const isWelcomeScreen = !selectedResource && !showBrowseMode;
			if (isWelcomeScreen) {
				// Always allow scrolling on homepage
				document.documentElement.classList.remove('no-root-scroll');
				document.body.classList.remove('no-root-scroll');
			} else { document.documentElement.classList.remove('no-root-scroll'); document.body.classList.remove('no-root-scroll'); }
		} catch (e) { }
	}
	function handleGlobalExpand() { expandAllScope.set('global'); if ($ulExpanded.length > 0) { expandAll.set(false); } else { expandAll.set(true); } }
	function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; }

	function toggleGroupShow(label: string) {
		groupedReleases = groupedReleases.map(g => g.label === label ? { ...g, showMore: !g.showMore } : g);
	}

	function setGroupShow(label: string, value: boolean) {
		groupedReleases = groupedReleases.map(g => g.label === label ? { ...g, showMore: value } : g);
	}

// Focus trap helpers
function focusableElements(container: HTMLElement) {
	return Array.from(container.querySelectorAll<HTMLElement>(`a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])`)).filter(el => !el.hasAttribute('disabled'));
}

function trapFocus(container: HTMLElement) {
	lastActiveElement = document.activeElement;
	const focusables = focusableElements(container);
	if (focusables.length) focusables[0].focus();
	const keyHandler = (e: KeyboardEvent) => {
		if (e.key === 'Tab') {
			const focusables = focusableElements(container);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault(); last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault(); first.focus();
			}
		} else if (e.key === 'Escape') {
			if (mobileReleasesOpen) {
				mobileReleasesOpen = false;
			}
		}
	};
	container.addEventListener('keydown', keyHandler);
	return () => { container.removeEventListener('keydown', keyHandler); if (lastActiveElement instanceof HTMLElement) lastActiveElement.focus(); };
}

	async function loadCrdsForRelease(release: EdaRelease): Promise<CrdResource[]> {
		try {
			const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
			if (manifestResponse.ok) {
				const manifest = await manifestResponse.json();
				crdMetaStore.set(manifest);
				return manifest as CrdResource[];
			}
		} catch (e) { }
		try {
			const res = await import('$lib/resources.yaml?raw');
			const resources = yaml.load(res.default) as CrdVersionsMap;
			const crdMeta = Object.values(resources).flat();
			crdMetaStore.set(crdMeta);
			return crdMeta as CrdResource[];
		} catch (e) {
			crdMetaStore.set([]);
			return [] as CrdResource[];
		}
	}
	async function loadVersionsForRelease(release: EdaRelease): Promise<string[]> {
			try {
				const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
				if (manifestResponse.ok) {
					const manifest = await manifestResponse.json();
					console.log('[diagnostic] loadVersionsForRelease()', release.name, 'manifest length', Array.isArray(manifest) ? manifest.length : typeof manifest, manifest?.slice?.(0,2));
					const versionSet = new Set<string>();
					manifest.forEach((resource: any) => { resource.versions?.forEach((v: any) => { versionSet.add(v.name); }); });
					return Array.from(versionSet).sort();
				}
			} catch (e) { console.warn('[diagnostic] loadVersionsForRelease() failed for', release.name, e); }
		return [];
	}
	async function loadVersionsForResourceInRelease(release: EdaRelease, resourceName: string): Promise<string[]> {
		try { const manifestUrl = `/${release.folder}/manifest.json`; const manifestResponse = await fetch(manifestUrl); if (manifestResponse.ok) { const manifest = await manifestResponse.json(); const resource = manifest.find((r: any) => r.name === resourceName); if (resource && resource.versions) { return resource.versions.map((v: any) => v.name); } } } catch (e) { }
		return [];
	}
	async function selectResource(resourceName: string, version: string) {
		selectedResource = resourceName; selectedVersion = version; loading = true; showDiff = false; compareVersion = null; compareData = null; showReleaseComparison = false; compareRelease = null; compareReleaseData = null; mobileMenuOpen = false;
		expandAll.set(false); expandAllScope.set('local'); ulExpanded.set([]);
		try { const folder = $releaseFolder; const response = await fetch(`/${folder}/${resourceName}/${version}.yaml`); if (!response.ok) throw new Error('Failed to load resource'); const yamlText = await response.text(); resourceData = yaml.load(yamlText) as any; } catch (error) { resourceData = null; } finally { loading = false; }
	}

	async function handleHomeResourceClick(resourceName: string) {
		// Ensure we have the manifest for the selected release and pick a version that exists in this release
		const manifest = await loadCrdsForRelease($selectedRelease);
		const resourceInRelease = (manifest || []).find((r: any) => r.name === resourceName);
		if (resourceInRelease && resourceInRelease.versions && resourceInRelease.versions.length) {
			const version = resourceInRelease.versions[0].name;
			goto(`/${resourceName}/${version}?release=${$selectedRelease.name}`);
		} else {
			// If not found, go to browse mode for the selected release
			goto(`/?browse=true&release=${$selectedRelease.name}`);
		}
	}
	async function toggleDiff(version: string) {
		if (showDiff && compareVersion === version) { showDiff = false; compareVersion = null; compareData = null; return; }
		try { const folder = $releaseFolder; const response = await fetch(`/${folder}/${selectedResource}/${version}.yaml`); if (!response.ok) throw new Error('Failed'); const yamlText = await response.text(); compareData = yaml.load(yamlText) as any; compareVersion = version; showDiff = true; } catch (error) { compareData = null; }
	}
    
	async function toggleReleaseComparison(release: EdaRelease) {
		if (showReleaseComparison && compareRelease?.name === release.name) { showReleaseComparison = false; compareRelease = null; compareReleaseData = null; return; }
		try { const response = await fetch(`/${release.folder}/${selectedResource}/${selectedVersion}.yaml`); if (!response.ok) { alert(`Not available in ${release.label}`); return; } const yamlText = await response.text(); compareReleaseData = yaml.load(yamlText) as any; compareRelease = release; showReleaseComparison = true; showDiff = false; compareVersion = null; compareData = null; } catch (error) { alert(`Failed to load`); compareReleaseData = null; showReleaseComparison = false; compareRelease = null; }
	}
    
    
    

	// CSV helper
    

    
	async function validateYaml() {
		const { default: Ajv } = await import('ajv');
		if (!yamlInput.trim()) { validationErrors = []; validationResult = null; return; }
		isValidating = true; validationErrors = []; validationResult = null;
		try {
			const parsedDocs: any[] = []; const allDocs = yaml.loadAll(yamlInput); parsedDocs.push(...allDocs.filter(d => d !== null && d !== undefined));
			if (parsedDocs.length === 0) { validationErrors = [{ message: 'No valid YAML' }]; validationResult = 'invalid'; isValidating = false; return; }
			const specSchema = resourceData?.schema?.openAPIV3Schema?.properties?.spec;
			if (!specSchema) { validationErrors = [{ message: 'No schema' }]; validationResult = 'invalid'; isValidating = false; return; }
			const ajv = new Ajv({ allErrors: true } as any);
			let valid = true; const errors: any[] = [];
			parsedDocs.forEach((parsedYaml) => {
				if (!parsedYaml.spec) { errors.push({ instancePath: '/spec', message: 'Missing spec' }); valid = false; return; }
				try { const validator = ajv.compile(specSchema); const isValid = validator(parsedYaml.spec); if (!isValid && validator.errors) { valid = false; errors.push(...validator.errors.map((e: any) => ({ instancePath: e.instancePath || '/spec', message: e.message || 'Error' }))); } } catch (e) { valid = false; errors.push({ instancePath: '/spec', message: 'Validation error' }); }
			});
			if (valid) { validationResult = 'valid'; } else { validationErrors = errors; validationResult = 'invalid'; }
		} catch (error) { validationErrors = [{ message: 'YAML error' }]; validationResult = 'invalid'; } finally { isValidating = false; }
	}
</script>

<svelte:head>
	<title>EDA Resource Browser{selectedResource ? ` | ${resourceInfo?.kind || selectedResource}` : ''}</title>
</svelte:head>

<div class="relative flex flex-col lg:min-h-screen overflow-y-auto lg:overflow-hidden pt-16 md:pt-20">
	<div class="flex flex-1 flex-col lg:flex-row relative z-10">
		{#if selectedResource}
			<button on:click={toggleMobileMenu} class="fixed top-4 left-6 z-60 no-blur p-2 rounded-lg bg-blue-600 text-white shadow-xl" aria-label="Toggle menu">
				<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					{#if mobileMenuOpen}<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					{:else}<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />{/if}
				</svg>
			</button>
		{/if}
		{#if selectedResource}
		<div class="{mobileMenuOpen ? 'translate-x-0' : 'lg:translate-x-0 -translate-x-full'} fixed inset-y-0 left-0 w-80 lg:w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col shadow-xl z-40 transition-transform duration-300">
			<div class="p-4 border-b border-gray-200 dark:border-gray-700">
				<button on:click={() => { showBrowseMode = false; mobileMenuOpen = false; goto('/'); }} class="flex items-center space-x-2 group">
					<img src="/images/eda.svg" width="48" height="48" alt="Nokia EDA" />
										<div>
																							<h1 class="text-4xl md:text-5xl lg:text-6xl font-extrabold font-nokia-headline text-yellow-400 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Nokia EDA</h1>
																						<p class="text-sm md:text-base text-white font-light font-nokia-headline mt-1">Resource Browser</p>
										</div>
				</button>
				<div class="mt-4 relative"><input id="resource-search-input" type="text" placeholder="Search resources..." bind:value={$resourceSearch} class="w-full rounded-lg pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" /></div>
			</div>
			<div class="flex-1 overflow-y-auto p-3">
				<ul class="space-y-1">
					{#each $resourceSearchFilter as resource}
						{@const resDef = $crdMetaStore.filter((x) => x.name == resource)[0]}
						{#if resDef}
							<li><button class="w-full px-3 py-2 text-left rounded-lg transition-colors {resource === selectedResource ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}" on:click={() => handleHomeResourceClick(resource)}><span class="font-medium text-sm">{resDef.kind || resDef.name.split('.')[0]}</span></button></li>
						{/if}
					{/each}
				</ul>
			</div>
		</div>
		{/if}
		{#if mobileMenuOpen && selectedResource}<button class="lg:hidden fixed inset-0 bg-black/50 z-30" on:click={() => mobileMenuOpen = false} aria-label="Close"></button>{/if}
		
		<div id="main-scroll" class="relative flex-1 overflow-y-auto flex flex-col has-header-img">
			<!-- Background is provided by CSS class .has-header-img; single background only (keep consistent with other pages) -->
			{#if !selectedResource && !showBrowseMode}
				<!-- YANG-Style Homepage -->
				<div class="block">
					<!-- Header removed for compact homepage design -->

						{#if mobileReleasesOpen}
							<div class="fixed inset-0 z-50 lg:hidden" aria-hidden={!mobileReleasesOpen}>
								<button class="absolute inset-0 bg-black/50" aria-label="Close releases" on:click={() => mobileReleasesOpen = false}></button>
								<div bind:this={mobileReleasesPanelEl} id="mobile-releases-panel" role="dialog" aria-modal="true" tabindex="-1" class="absolute top-12 left-4 right-4 bg-gray-900 text-white rounded-lg p-4 shadow-lg overflow-auto max-h-[70vh]">
	                                <div class="flex items-center justify-between mb-3">
	                                    <h3 class="text-lg font-semibold">Releases</h3>
										<button class="p-1.5 rounded-md bg-gray-800/60" aria-label="Close" on:click={() => mobileReleasesOpen = false}>
	                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
	                                    </button>
	                                </div>
                                                    <div class="space-y-2">
                                        			{#each groupedReleases as group}
                                        				<div>
                                        					<div class="text-sm font-semibold text-white mb-1">{group.label}</div>
                                        					<div class="flex flex-wrap gap-2">
                                        						{#each group.releases as release}
                                        							<button on:click={() => { selectedRelease.set(release); mobileReleasesOpen = false; goto(`/?release=${release.name}`); }} class="px-3 py-2 text-xs sm:text-base rounded-xl bg-gray-800/60 text-white hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro border-2 border-slate-700/30">{release.name}</button>
                                        						{/each}
                                        					</div>
                                        				</div>
                                        			{/each}
                                    			</div>
								</div>
	                        </div>
	                    {/if}

					<!-- Main Content -->
					<div class="relative">
						<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:py-12 min-h-[220px] sm:min-h-[340px] md:min-h-[420px]">
							<!-- YANG-style Releases + Info two-column hero -->
							<div class="mb-8">
								<div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
									<!-- Left: grouped releases -->
									<div class="space-y-6">
										<div class="flex items-center gap-4 ml-0 sm:ml-0 justify-start flex-nowrap">
											<img src="/images/bird-logo.svg" alt="Nokia" class="w-14 h-14 sm:w-24 sm:h-24" loading="eager" fetchpriority="high" width="96" height="96" />
											<img src="/images/eda.svg" alt="EDA" class="w-12 h-12 sm:w-20 sm:h-20" loading="eager" fetchpriority="high" width="80" height="80" />
										</div>
										<div>
											<h1 class="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold font-nokia-headline text-yellow-400 leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] text-left">
												Nokia EDA
											</h1>
											<p class="text-base sm:text-xl md:text-2xl text-white mt-1 font-light font-nokia-headline tracking-tight text-left">Resource Browser</p>
										</div>
										<p class="text-sm sm:text-base text-gray-300 mt-4">Browse released EDA Custom Resource Definitions grouped by major version</p>
										<div class="mt-4 space-y-6">
											{#each groupedReleases as group}
												<div class="flex items-center gap-4">
													<div class="w-14 text-white font-semibold mt-1 text-sm sm:text-base">{group.label}</div>
													<div class="flex-1">
														<div class="flex flex-wrap gap-2">
															{#each group.releases.slice(0,3) as release}
																<button on:click={async () => { selectedRelease.set(release); const manifest = await loadCrdsForRelease(release); const firstResource = manifest && manifest.length ? manifest[0] : undefined; if (firstResource) { const firstVersion = firstResource.versions?.[0]?.name; if (firstVersion) { goto(`/${firstResource.name}/${firstVersion}?release=${release.name}`); } } mobileReleasesOpen = false; }} class="px-4 py-3 rounded-xl bg-gray-800/60 border-2 border-slate-700/30 text-white text-sm font-medium hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro">{release.name}</button>
															{/each}
															{#if group.releases.length > 3}
																<div class="relative inline-block">
																	<button on:click={() => toggleGroupShow(group.label)} on:keydown={(e) => {
																		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroupShow(group.label); }
																		if (e.key === 'ArrowDown') { e.preventDefault(); setGroupShow(group.label, true); setTimeout(() => { const menu = e.currentTarget.nextElementSibling as HTMLElement; if (menu) { const first = menu.querySelector<HTMLElement>('button[tabindex="0"]'); if (first) first.focus(); } }, 0); }
																	}} tabindex="0" class="release-more-btn px-4 py-3 rounded-xl bg-gray-800/60 border-2 border-slate-700/30 text-white text-sm font-medium hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro">More ▾</button>
																	{#if group.showMore}
																		<div class="absolute mt-2 bg-gray-800 dark:bg-gray-900 border-2 border-gray-700 rounded-xl shadow-pro p-2 z-40 min-w-32 max-h-60 overflow-y-auto">
																			{#each group.releases.slice(3) as r}
																				<button tabindex="0" on:click={async () => { selectedRelease.set(r); const manifest = await loadCrdsForRelease(r); const firstResource = manifest && manifest.length ? manifest[0] : undefined; if (firstResource) { const firstVersion = firstResource.versions?.[0]?.name; if (firstVersion) { goto(`/${firstResource.name}/${firstVersion}?release=${r.name}`); } } mobileReleasesOpen = false; setGroupShow(group.label, false); }} class="block w-full text-left px-4 py-3 rounded-lg text-white hover:bg-gray-700 hover:text-white transition-colors text-sm">{r.name}</button>
																			{/each}
																		</div>
																	{/if}
																</div>
															{/if}
														</div>
													</div>
												</div>
											{/each}
										</div>
									</div>
									<!-- Right: info panel -->
									<div class="flex items-center">
											<div class="w-full bg-transparent dark:bg-black/20 rounded-xl p-5 sm:p-6 border border-white/10 dark:border-white/10 shadow-pro">
												<h3 class="text-lg sm:text-xl font-semibold text-yellow-400 mb-3">About Nokia EDA</h3>
												<div class="text-base sm:text-lg text-gray-200 dark:text-gray-200 leading-relaxed">
													{@html nokiaEdaDescription.split('\n\n').map(p => `<p class="mb-2">${p}</p>`).join('')}
												</div>
											</div>
									</div>
								</div>
							</div>

							<!-- Quick Tools -->
							<div class="mt-12">
								<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
									<button
										on:click={()=> goto('/comparison')}
										class="bg-white/5 dark:bg-gray-900/70 rounded-xl border-2 border-white/10 dark:border-white/10 p-6 hover:border-purple-500 dark:hover:border-purple-400 transition-all duration-200 hover:shadow-lg text-left group shadow-pro"
									>
										<div class="flex items-start space-x-4">
											<div class="flex-shrink-0 w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors">
												<svg class="h-6 w-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
												</svg>
											</div>
											<div class="flex-1">
												<h3 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
													Release Comparison
												</h3>
												<p class="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
													Compare CRDs across different EDA releases and generate detailed diff reports
												</p>
											</div>
										</div>
									</button>

                                    
									<!-- Spec Search Quick Tool -->
									<button
										on:click={() => { goto('/spec-search'); }}
										class="bg-white/5 dark:bg-gray-900/70 rounded-xl border-2 border-white/10 dark:border-white/10 p-6 hover:border-blue-500 dark:hover:border-blue-400 transition-all duration-200 hover:shadow-lg text-left group shadow-pro"
									>
										<div class="flex items-start space-x-4">
											<div class="flex-shrink-0 w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
												<svg class="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
												</svg>
											</div>
											<div class="flex-1">
												<h3 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
													Spec Search
												</h3>
												<p class="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
													Quickly search and find specific CRD schema properties and elements
												</p>
											</div>
										</div>
									</button>
								</div>
							</div>

                            
						</div>
					</div>
				</div>
			{:else if loading}
				<div class="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
					<div class="text-center">
						<svg class="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<p class="text-gray-600 dark:text-gray-300">Loading resource...</p>
					</div>
				</div>
			{:else if resourceData}
				<div class="flex-1 bg-gray-50 dark:bg-gray-800">
					<div class="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
						<div class="mb-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
							<div class="border-b border-gray-200 dark:border-gray-700 p-6 pl-14 lg:pl-6">
								<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-4">
									<div>
										<h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-1">{formatResourceName(resourceInfo?.name || '')}</h2>
										<p class="text-sm text-gray-600 dark:text-gray-300 font-mono">{formatGroupName(resourceInfo?.name || '')}</p>
									</div>
									<div class="flex items-center space-x-2 mt-4 lg:mt-0">
										<button
											on:click={() => viewMode = 'schema'}
											class="px-4 py-2 rounded-lg font-medium text-sm transition-colors {viewMode === 'schema' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
										>
											Schema
										</button>
										<button
											on:click={() => viewMode = 'validate'}
											class="px-4 py-2 rounded-lg font-medium text-sm transition-colors {viewMode === 'validate' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
										>
											Validate
										</button>
									</div>
								</div>
							</div>
							
							<div class="p-6">
								{#if viewMode === 'schema'}
									<Render hash="" source="eda" type="spec" data={resourceData.schema.openAPIV3Schema.properties.spec} showType={false} onResourcePage={true} />
								{:else}
									<div class="space-y-4">
										<div>
											<label for="yaml-input" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
												Paste your YAML configuration
											</label>
											<textarea
												id="yaml-input"
												bind:value={yamlInput}
												placeholder="apiVersion: ...\nkind: ...\nmetadata:\n  name: ...\nspec:\n  ..."
												rows="12"
												class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
											></textarea>
										</div>
										<div class="flex justify-end">
											<button
												on:click={validateYaml}
												disabled={isValidating || !yamlInput.trim()}
												class="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
											>
												{isValidating ? 'Validating...' : 'Validate YAML'}
											</button>
										</div>
										{#if validationResult === 'valid'}
											<div class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
												<div class="flex items-start space-x-3">
													<svg class="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
													</svg>
													<div>
														<p class="font-medium text-green-900 dark:text-green-300">Valid Configuration</p>
														<p class="text-sm text-green-800 dark:text-green-400 mt-1">Your YAML matches the schema requirements.</p>
													</div>
												</div>
											</div>
										{/if}
										{#if validationResult === 'invalid' && validationErrors.length > 0}
											<div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
												<div class="flex items-start space-x-3">
													<svg class="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
													</svg>
													<div class="flex-1">
														<p class="font-medium text-red-900 dark:text-red-300 mb-2">Validation Errors ({validationErrors.length})</p>
														<ul class="space-y-2">
															{#each validationErrors as error}
																<li class="text-sm text-red-800 dark:text-red-400">
																	<span class="font-mono text-xs bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded">{error.instancePath || '/'}</span>
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
        
	<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
		<PageCredits />
	</div>
</div>
