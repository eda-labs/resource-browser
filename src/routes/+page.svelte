<script lang="ts">
	import { derived, writable } from 'svelte/store';
	import { onMount, onDestroy } from 'svelte';
	import { goto, afterNavigate } from '$app/navigation';
	import Ajv from 'ajv';
	import Footer from '$lib/components/Footer.svelte';
	import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
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
	let showBulkDiffModal = false;
	let bulkDiffDialogEl: HTMLElement | null = null;
	let mobileReleasesPanelEl: HTMLElement | null = null;
	let lastActiveElement: Element | null = null;
	let bulkTrapCleanup: (() => void) | null = null;
	let mobileTrapCleanup: (() => void) | null = null;
	// Prevent the modal backdrop from closing while a native <select> dropdown is open
	let preventDropdownClose = false;

	function handleModalBackdropClick(e: MouseEvent) {
		// Only close when clicking the backdrop itself (not the dialog content)
		if (e.target === e.currentTarget && !bulkDiffGenerating && !preventDropdownClose) {
			showBulkDiffModal = false;
		}
	}

	function handleSelectOpen() {
		preventDropdownClose = true;
		console.debug('[diagnostic] handleSelectOpen set preventDropdownClose =', preventDropdownClose);
	}

	function handleSelectClose() {
		// small delay to allow native select to close before re-enabling backdrop clicks
		setTimeout(() => { preventDropdownClose = false; console.debug('[diagnostic] handleSelectClose set preventDropdownClose =', preventDropdownClose); }, 150);
	}
	let bulkDiffSourceRelease: EdaRelease | null = null;
	let bulkDiffSourceVersion: string = '';
	let bulkDiffTargetRelease: EdaRelease | null = null;
	let bulkDiffTargetVersion: string = '';
	let bulkDiffProgress = 0;
	let bulkDiffGenerating = false;
	let bulkDiffReport: any = null;
	let bulkDiffStatusFilter: string[] = ['added', 'removed', 'modified'];
	let bulkDiffSourceVersions: string[] = [];
	let bulkDiffTargetVersions: string[] = [];
	let bulkDiffSourceReleaseName: string = '';
	let bulkDiffTargetReleaseName: string = '';
	let bulkDiffSourceVersionsLoading = false;
	let bulkDiffTargetVersionsLoading = false;
	let yamlInput = '';
	let expandedCrdNames: string[] = [];
	let validationErrors: any[] = [];
	let isValidating = false;
	let validationResult: 'valid' | 'invalid' | null = null;
	let releaseAvailability: Map<string, boolean> = new Map();
	
	$: currentResourceDef = selectedResource ? $crdMetaStore.find(x => x.name === selectedResource) : null;
	$: filteredBulkDiffCrds = bulkDiffReport ? bulkDiffReport.crds.filter((crd: any) => bulkDiffStatusFilter.includes(crd.status)) : [];
	$: resourceInfo = resourceData ? { kind: resourceData.spec?.names?.kind || '', group: resourceData.spec?.group || '', name: selectedResource || '' } : null;
	$: if (selectedResource || selectedVersion) { releaseAvailability.clear(); }
	$: { loadCrdsForRelease($selectedRelease); selectedResource = null; selectedVersion = null; resourceData = null; }
	// When the selected release object changes, load versions and set version lists
	$: if (compareRelease && selectedResource) { loadVersionsForResourceInRelease(compareRelease, selectedResource).then(versions => { compareReleaseVersions = versions; }); } else { compareReleaseVersions = []; }
	$: updateRootScroll();
	$: bulkDiffSourceRelease = bulkDiffSourceReleaseName ? releasesConfig.releases.find(x => x.name === bulkDiffSourceReleaseName) || null : null;
	$: bulkDiffTargetRelease = bulkDiffTargetReleaseName ? releasesConfig.releases.find(x => x.name === bulkDiffTargetReleaseName) || null : null;
	$: if (bulkDiffSourceRelease) loadVersionsForBulkDiffSource(); else { bulkDiffSourceVersions = []; bulkDiffSourceVersion = ''; bulkDiffSourceVersionsLoading = false; }
	$: if (bulkDiffTargetRelease) loadVersionsForBulkDiffTarget(); else { bulkDiffTargetVersions = []; bulkDiffTargetVersion = ''; bulkDiffTargetVersionsLoading = false; }

	async function loadVersionsForBulkDiffSource() {
		bulkDiffSourceVersionsLoading = true;
		try {
			const versions = await loadVersionsForRelease(bulkDiffSourceRelease!);
			bulkDiffSourceVersions = versions;
			if (!versions.includes(bulkDiffSourceVersion)) bulkDiffSourceVersion = '';
		} catch (e) {
			bulkDiffSourceVersions = [];
			bulkDiffSourceVersion = '';
		} finally {
			bulkDiffSourceVersionsLoading = false;
		}
	}

	async function loadVersionsForBulkDiffTarget() {
		bulkDiffTargetVersionsLoading = true;
		try {
			const versions = await loadVersionsForRelease(bulkDiffTargetRelease!);
			bulkDiffTargetVersions = versions;
			if (!versions.includes(bulkDiffTargetVersion)) bulkDiffTargetVersion = '';
		} catch (e) {
			bulkDiffTargetVersions = [];
			bulkDiffTargetVersion = '';
		} finally {
			bulkDiffTargetVersionsLoading = false;
		}
	}

	onMount(() => {
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.get('browse') === 'true') { showBrowseMode = true; }
		const releaseParam = urlParams.get('release');
		if (releaseParam) { showBrowseMode = true; const foundRelease = releasesConfig.releases.find(r => r.name === releaseParam); if (foundRelease) { selectedRelease.set(foundRelease); } }
		afterNavigate(() => setTimeout(updateRootScroll, 0));
		updateRootScroll();
	});

// React to modal/panel open state to enable focus trapping and prevent background scroll
$: if (typeof window !== 'undefined') {
	if (showBulkDiffModal) {
		console.log('[diagnostic] BulkDiff modal opened', { releases: (releasesConfig.releases || []).map(r => r.name), bulkDiffSourceReleaseName, bulkDiffTargetReleaseName, bulkDiffSourceVersionsLength: bulkDiffSourceVersions.length, bulkDiffTargetVersionsLength: bulkDiffTargetVersions.length });
		// lock root scroll
		document.documentElement.classList.add('no-root-scroll');
		document.body.classList.add('no-root-scroll');
		// setup trap after DOM updates
		setTimeout(() => {
			if (bulkDiffDialogEl) {
				if (bulkTrapCleanup) bulkTrapCleanup();
				// bulkTrapCleanup = trapFocus(bulkDiffDialogEl); // temporarily disabled to test select dropdown
			}
		}, 0);
	} else {
		if (bulkTrapCleanup) { bulkTrapCleanup(); bulkTrapCleanup = null; }
		document.documentElement.classList.remove('no-root-scroll');
		document.body.classList.remove('no-root-scroll');
	}
}

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
			// Close if modal is not generating
			if (!bulkDiffGenerating) {
				showBulkDiffModal = false;
			}
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
	async function checkCrdInRelease(release: EdaRelease, resourceName: string, version: string): Promise<boolean> {
		const cacheKey = `${release.name}:${resourceName}:${version}`;
		if (releaseAvailability.has(cacheKey)) { return releaseAvailability.get(cacheKey)!; }
		try { const response = await fetch(`/${release.folder}/${resourceName}/${version}.yaml`, { method: 'HEAD', cache: 'force-cache' }); const exists = response.ok; releaseAvailability.set(cacheKey, exists); return exists; } catch (error) { releaseAvailability.set(cacheKey, false); return false; }
	}
	async function toggleReleaseComparison(release: EdaRelease) {
		if (showReleaseComparison && compareRelease?.name === release.name) { showReleaseComparison = false; compareRelease = null; compareReleaseData = null; return; }
		try { const response = await fetch(`/${release.folder}/${selectedResource}/${selectedVersion}.yaml`); if (!response.ok) { alert(`Not available in ${release.label}`); return; } const yamlText = await response.text(); compareReleaseData = yaml.load(yamlText) as any; compareRelease = release; showReleaseComparison = true; showDiff = false; compareVersion = null; compareData = null; } catch (error) { alert(`Failed to load`); compareReleaseData = null; showReleaseComparison = false; compareRelease = null; }
	}
	async function generateBulkDiffReport() {
		if (!bulkDiffSourceRelease || !bulkDiffTargetRelease || !bulkDiffSourceVersion || !bulkDiffTargetVersion) { alert('Please select both releases'); return; }
		bulkDiffGenerating = true; bulkDiffProgress = 0;
		const report: any = { sourceRelease: bulkDiffSourceRelease.label, sourceVersion: bulkDiffSourceVersion, targetRelease: bulkDiffTargetRelease.label, targetVersion: bulkDiffTargetVersion, generatedAt: new Date().toISOString(), crds: [] };
		const allCrds = $crdMetaStore; const totalCrds = allCrds.length; const batchSize = 20; const batches = [];
		for (let i = 0; i < allCrds.length; i += batchSize) { batches.push(allCrds.slice(i, i + batchSize)); }
		for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
			const batch = batches[batchIndex];
			const batchPromises = batch.map(async (crd) => {
				try {
					const [sourceExists, targetExists] = await Promise.all([ checkCrdInRelease(bulkDiffSourceRelease!, crd.name, bulkDiffSourceVersion), checkCrdInRelease(bulkDiffTargetRelease!, crd.name, bulkDiffTargetVersion) ]);
					const crdReport: any = { name: crd.name, kind: crd.kind, status: '', hasDiff: false, details: [] };
					if (!sourceExists && !targetExists) { crdReport.status = 'not-in-either'; crdReport.details.push(`Not available`); } 
					else if (!sourceExists) { crdReport.status = 'added'; crdReport.hasDiff = true; crdReport.details.push(`Added`); } 
					else if (!targetExists) { crdReport.status = 'removed'; crdReport.hasDiff = true; crdReport.details.push(`Removed`); } 
					else {
						const [sourceResponse, targetResponse] = await Promise.all([ fetch(`/${bulkDiffSourceRelease!.folder}/${crd.name}/${bulkDiffSourceVersion}.yaml`), fetch(`/${bulkDiffTargetRelease!.folder}/${crd.name}/${bulkDiffTargetVersion}.yaml`) ]);
						if (sourceResponse.ok && targetResponse.ok) {
							const [sourceYaml, targetYaml] = await Promise.all([sourceResponse.text(), targetResponse.text()]);
							const sourceData = yaml.load(sourceYaml) as any; const targetData = yaml.load(targetYaml) as any;
							const allChanges = compareSchemas(sourceData, targetData);
							if (allChanges.length > 0) { crdReport.status = 'modified'; crdReport.hasDiff = true; crdReport.details = allChanges; } 
							else { crdReport.status = 'unchanged'; crdReport.details.push('No changes'); }
						}
					}
					return crdReport;
				} catch (error) { return { name: crd.name, kind: crd.kind, status: 'error', hasDiff: false, details: ['Error'] }; }
			});
			const batchResults = await Promise.all(batchPromises); report.crds.push(...batchResults);
			const processedSoFar = (batchIndex + 1) * batchSize; bulkDiffProgress = Math.round(Math.min(processedSoFar, totalCrds) / totalCrds * 100);
		}
			// Normalize the report to plain JS objects to avoid reactivity/proxy edge-cases
			bulkDiffReport = JSON.parse(JSON.stringify(report));
			bulkDiffGenerating = false;
	}
	function compareSchemas(sourceData: any, targetData: any): string[] {
		function compareObjects(source: any, target: any, path = ''): string[] {
			const changes: string[] = []; const sourceKeys = new Set(Object.keys(source || {})); const targetKeys = new Set(Object.keys(target || {}));
			for (const key of targetKeys) { if (!sourceKeys.has(key)) { changes.push(`+ Added: ${path}${key}`); } }
			for (const key of sourceKeys) { if (!targetKeys.has(key)) { changes.push(`- Removed: ${path}${key}`); } }
			for (const key of sourceKeys) {
				if (targetKeys.has(key)) {
					const sourceVal = source[key]; const targetVal = target[key];
					if (typeof sourceVal === 'object' && typeof targetVal === 'object' && !Array.isArray(sourceVal) && !Array.isArray(targetVal)) { changes.push(...compareObjects(sourceVal, targetVal, `${path}${key}.`)); } 
					else if (JSON.stringify(sourceVal) !== JSON.stringify(targetVal)) { changes.push(`~ Modified: ${path}${key}`); }
				}
			}
			return changes;
		}
		const specChanges = compareObjects(sourceData.schema?.openAPIV3Schema?.properties?.spec?.properties, targetData.schema?.openAPIV3Schema?.properties?.spec?.properties, 'spec.');
		const statusChanges = compareObjects(sourceData.schema?.openAPIV3Schema?.properties?.status?.properties, targetData.schema?.openAPIV3Schema?.properties?.status?.properties, 'status.');
		return [...specChanges, ...statusChanges];
	}
	function downloadBulkDiffReport(format: 'json' | 'text' | 'markdown' | 'csv') {
		if (!bulkDiffReport) return;
		let content = '';
		let filename = '';
		let mimeType = '';

		// Include metadata and full CRD details for all formats
		const header = `Report\nGenerated: ${bulkDiffReport.generatedAt}\nSource: ${bulkDiffReport.sourceRelease} ${bulkDiffReport.sourceVersion}\nTarget: ${bulkDiffReport.targetRelease} ${bulkDiffReport.targetVersion}\nTotal CRDs: ${bulkDiffReport.crds.length}\n\n`;

		if (format === 'json') {
			content = JSON.stringify(bulkDiffReport, null, 2);
			filename = `bulk-diff-${bulkDiffReport.sourceRelease}-${bulkDiffReport.sourceVersion}_to_${bulkDiffReport.targetRelease}-${bulkDiffReport.targetVersion}.json`;
			mimeType = 'application/json';
		} else if (format === 'text') {
			const lines: string[] = [header, 'CRDs:\n'];
			for (const c of bulkDiffReport.crds) {
				lines.push(`- ${c.name} (${c.kind}) [${c.status}]`);
				if (c.details && c.details.length > 0) {
					for (const d of c.details) {
						lines.push(`    ${d}`);
					}
				}
			}
			content = lines.join('\n');
			filename = `bulk-diff-${bulkDiffReport.sourceRelease}-${bulkDiffReport.sourceVersion}_to_${bulkDiffReport.targetRelease}-${bulkDiffReport.targetVersion}.txt`;
			mimeType = 'text/plain';
		} else {
			// markdown
			const md: string[] = [];
			md.push(`# Bulk Diff Report`);
			md.push(`**Generated:** ${bulkDiffReport.generatedAt}`);
			md.push(`**Source:** ${bulkDiffReport.sourceRelease} ${bulkDiffReport.sourceVersion}`);
			md.push(`**Target:** ${bulkDiffReport.targetRelease} ${bulkDiffReport.targetVersion}`);
			md.push(`**Total CRDs:** ${bulkDiffReport.crds.length}`);
			md.push('\n---\n');
			for (const c of bulkDiffReport.crds) {
				md.push(`## ${c.name} (${c.kind})`);
				md.push(`- Status: **${c.status}**`);
				if (c.details && c.details.length > 0) {
					md.push('\n**Details:**');
					for (const d of c.details) {
						md.push(`- ${d}`);
					}
				} else {
					md.push('\n_No additional details._');
				}
				md.push('');
			}
			content = md.join('\n');
			filename = `bulk-diff-${bulkDiffReport.sourceRelease}-${bulkDiffReport.sourceVersion}_to_${bulkDiffReport.targetRelease}-${bulkDiffReport.targetVersion}.md`;
			mimeType = 'text/markdown';
		}
    
		if (format === 'csv') {
			// Build CSV with columns: name,kind,status,detail
			const rows: string[] = [];
			rows.push(['name','kind','status','detail'].map(escapeCsv).join(','));
			for (const c of bulkDiffReport.crds) {
				if (c.details && c.details.length > 0) {
					for (const d of c.details) {
						rows.push([escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.status), escapeCsv(d)].join(','));
					}
				} else {
					rows.push([escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.status), escapeCsv('')].join(','));
				}
			}
			content = rows.join('\n');
			filename = `bulk-diff-${bulkDiffReport.sourceRelease}-${bulkDiffReport.sourceVersion}_to_${bulkDiffReport.targetRelease}-${bulkDiffReport.targetVersion}.csv`;
			mimeType = 'text/csv';
		}

		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	// CSV helper
	function escapeCsv(value: string) {
		if (value == null) return '';
		const s = String(value).replace(/"/g, '""');
		return `"${s}"`;
	}

	function toggleCrdExpand(name: string) {
		if (expandedCrdNames.includes(name)) {
			expandedCrdNames = expandedCrdNames.filter(n => n !== name);
		} else {
			expandedCrdNames = [...expandedCrdNames, name];
		}
	}
	async function validateYaml() {
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

<div class="relative flex flex-col lg:min-h-screen overflow-y-auto lg:overflow-hidden pt-[64px]">
	<div class="flex flex-1 flex-col lg:flex-row relative z-10">
		{#if selectedResource}
			<button on:click={toggleMobileMenu} class="fixed top-4 left-6 z-50 p-2 rounded-lg bg-blue-600 text-white shadow-lg" aria-label="Toggle menu">
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
																						<p class="text-sm md:text-base text-blue-200 font-light font-nokia-headline mt-1">Resource Browser</p>
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
		
		<div id="main-scroll" class="flex-1 overflow-y-auto flex flex-col has-header-img">
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
												<div class="text-sm font-semibold text-amber-300 mb-1">{group.label}</div>
												<div class="flex flex-wrap gap-2">
													{#each group.releases as release}
														<button on:click={() => { selectedRelease.set(release); mobileReleasesOpen = false; goto(`/?release=${release.name}`); }} class="px-2 py-1 text-sm rounded-xl bg-gray-800/60 text-amber-200 hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro border-2 border-slate-700/30">{release.name}</button>
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
						<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
							<!-- YANG-style Releases + Info two-column hero -->
							<div class="mb-8">
								<div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
									<!-- Left: grouped releases -->
									<div class="space-y-6">
										<div class="flex items-center gap-6">
											<div class="flex items-center gap-3 mr-2">
												<img src="/images/bird-logo.svg" alt="Nokia" class="w-24 h-24" />
												<img src="/images/eda.svg" alt="EDA" class="w-20 h-20" />
											</div>
											<div>
												<h1 class="text-5xl md:text-6xl lg:text-7xl font-extrabold font-nokia-headline text-yellow-400 leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
													Nokia EDA
												</h1>
												<p class="text-xl md:text-2xl text-blue-200 mt-1 font-light font-nokia-headline tracking-tight">Resource Browser</p>
											</div>
										</div>
										<p class="text-base text-gray-300 mt-4">Browse released EDA Custom Resource Definitions grouped by major version</p>
										<div class="mt-4 space-y-6">
											{#each groupedReleases as group}
												<div class="flex items-start gap-4">
													<div class="w-12 text-amber-300 font-semibold mt-1">{group.label}</div>
													<div class="flex-1">
														<div class="flex flex-wrap gap-2">
															{#each group.releases.slice(0,3) as release}
																<button on:click={async () => { selectedRelease.set(release); const manifest = await loadCrdsForRelease(release); const firstResource = manifest && manifest.length ? manifest[0] : undefined; if (firstResource) { const firstVersion = firstResource.versions?.[0]?.name; if (firstVersion) { goto(`/${firstResource.name}/${firstVersion}?release=${release.name}`); } } mobileReleasesOpen = false; }} class="px-3 py-2 rounded-xl bg-gray-800/60 border-2 border-slate-700/30 text-amber-200 text-xs font-medium hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro">{release.name}</button>
															{/each}
															{#if group.releases.length > 3}
																<div class="relative inline-block">
																	<button on:click={() => toggleGroupShow(group.label)} on:keydown={(e) => {
																		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroupShow(group.label); }
																		if (e.key === 'ArrowDown') { e.preventDefault(); setGroupShow(group.label, true); setTimeout(() => { const menu = e.currentTarget.nextElementSibling as HTMLElement; if (menu) { const first = menu.querySelector<HTMLElement>('button[tabindex="0"]'); if (first) first.focus(); } }, 0); }
																	}} tabindex="0" class="px-3 py-2 rounded-xl bg-gray-800/60 border-2 border-slate-700/30 text-amber-200 text-xs font-medium hover:bg-gray-800/80 hover:border-amber-500 dark:hover:border-amber-400 transition-all duration-200 shadow-pro">More ▾</button>
																	{#if group.showMore}
																		<div class="absolute mt-2 bg-gray-800 dark:bg-gray-900 border-2 border-gray-700 rounded-xl shadow-pro p-2 z-40 min-w-32 max-h-60 overflow-y-auto">
																			{#each group.releases.slice(3) as r}
																				<button tabindex="0" on:click={async () => { selectedRelease.set(r); const manifest = await loadCrdsForRelease(r); const firstResource = manifest && manifest.length ? manifest[0] : undefined; if (firstResource) { const firstVersion = firstResource.versions?.[0]?.name; if (firstVersion) { goto(`/${firstResource.name}/${firstVersion}?release=${r.name}`); } } mobileReleasesOpen = false; setGroupShow(group.label, false); }} class="block w-full text-left px-3 py-2 rounded-lg text-amber-200 hover:bg-gray-700 hover:text-amber-100 transition-colors text-sm">{r.name}</button>
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
											<div class="w-full bg-transparent dark:bg-black/20 rounded-xl p-6 border border-white/10 dark:border-white/10 shadow-pro">
												<h3 class="text-xl font-semibold text-yellow-400 mb-3">About Nokia EDA</h3>
												<div class="text-lg text-gray-200 dark:text-gray-200 leading-relaxed">
													{@html nokiaEdaDescription.split('\n\n').map(p => `<p class="mb-2">${p}</p>`).join('')}
												</div>
											</div>
									</div>
								</div>
							</div>

							<!-- Quick Tools -->
							<div class="mt-12">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
									<button
										on:click={()=> showBulkDiffModal = true}
										class="bg-white/5 dark:bg-gray-900/70 rounded-xl border-2 border-white/10 dark:border-white/10 p-6 hover:border-purple-500 dark:hover:border-purple-400 transition-all duration-200 hover:shadow-lg text-left group shadow-pro"
									>
										<div class="flex items-start space-x-4">
											<div class="flex-shrink-0 w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors">
												<svg class="h-6 w-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
												</svg>
											</div>
											<div class="flex-1">
												<h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
													Release Comparison
												</h3>
												<p class="text-sm text-gray-600 dark:text-gray-300">
													Compare CRDs across different EDA releases and generate detailed diff reports
												</p>
											</div>
										</div>
									</button>

									<a
										href="https://docs.eda.dev"
										target="_blank"
										rel="noopener noreferrer"
										class="bg-white/5 dark:bg-gray-900/70 rounded-xl border-2 border-white/10 dark:border-white/10 p-6 hover:border-blue-500 dark:hover:border-blue-400 transition-all duration-200 hover:shadow-lg text-left group block shadow-pro"
									>
										<div class="flex items-start space-x-4">
											<div class="flex-shrink-0 w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
												<svg class="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
												</svg>
											</div>
											<div class="flex-1">
												<h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
													Documentation
												</h3>
												<p class="text-sm text-gray-600 dark:text-gray-300">
													Visit the official Nokia EDA documentation for guides and tutorials
												</p>
											</div>
											<svg class="h-5 w-5 text-gray-400 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
											</svg>
										</div>
									</a>
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
									<Render hash="" source="eda" type="spec" data={resourceData.schema.openAPIV3Schema.properties.spec} />
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
        
</div>

<!-- Bulk Diff Modal -->
{#if showBulkDiffModal}
	<div id="bulk-diff-dialog" bind:this={bulkDiffDialogEl} class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4" role="dialog" tabindex="-1" on:keydown={(e) => { if (e.key === 'Escape' && !bulkDiffGenerating) showBulkDiffModal = false; }} on:click={handleModalBackdropClick}>
	<div role="document" class="bg-white dark:bg-gray-800 rounded-lg sm:rounded-2xl shadow-2xl w-full h-full sm:max-w-2xl lg:max-w-4xl sm:h-auto sm:max-h-[90vh] flex flex-col">
			<div class="flex-shrink-0 sticky top-0 bg-gradient-to-r from-purple-600 to-indigo-600 px-4 sm:px-8 py-4 sm:py-6 rounded-t-lg sm:rounded-t-2xl">
				<div class="flex items-start sm:items-center justify-between gap-3">
					<div class="flex items-start sm:items-center gap-3">
						<div class="w-10 h-10 sm:w-12 sm:h-12 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
							<svg class="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
							</svg>
						</div>
						<div class="min-w-0">
							<h2 class="text-lg sm:text-2xl font-bold text-white">Generate Bulk Diff Report</h2>
							<p class="text-purple-100 text-xs sm:text-sm mt-1">Compare all CRDs between releases</p>
						</div>
					</div>
					{#if !bulkDiffGenerating}
						<button on:click={() => showBulkDiffModal = false} class="p-2 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0" aria-label="Close">
							<svg class="h-5 w-5 sm:h-6 sm:w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
						</button>
					{/if}
				</div>
			</div>
			<div class="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-8">
				{#if !bulkDiffReport}
					<!-- Info Banner -->
					<div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg sm:rounded-xl p-4 sm:p-6 mb-6 sm:mb-8">
						<div class="flex gap-3 sm:gap-4">
							<div class="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
								<svg class="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</div>
							<div class="min-w-0">
								<h3 class="text-base sm:text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">About Bulk Diff Reports</h3>
								<p class="text-blue-800 dark:text-blue-200 text-xs sm:text-sm leading-relaxed">
									This tool compares all Custom Resource Definitions (CRDs) between two EDA releases and versions, generating a comprehensive report of changes including additions, removals, and modifications. Use this to understand API evolution and plan migrations.
								</p>
							</div>
						</div>
					</div>

					<div class="space-y-6 sm:space-y-8">
						<!-- Source Release & Version -->
						<div>
							<label for="bulk-source-release" class="block text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Source Release & Version</label>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
								<div class="relative">
									<label for="bulk-source-release" class="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Release</label>
									<select id="bulk-source-release"
										bind:value={bulkDiffSourceReleaseName}
										on:mousedown={handleSelectOpen}
										on:focus={handleSelectOpen}
										on:blur={handleSelectClose}
										class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
										style="z-index:1000;"
									>
										<option value="">Select release...</option>
										{#each releasesConfig.releases as release}
											<option value={release.name}>{release.label}</option>
										{/each}
									</select>
								</div>
								<div class="relative">
									<label for="bulk-source-version" class="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Version</label>
									<select id="bulk-source-version"
										bind:value={bulkDiffSourceVersion}
										on:mousedown={handleSelectOpen}
										on:focus={handleSelectOpen}
										on:blur={handleSelectClose}
										class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
										style="z-index:1000;"
										disabled={!bulkDiffSourceRelease || bulkDiffSourceVersions.length === 0 || bulkDiffSourceVersionsLoading}
									>
										<option value="">{bulkDiffSourceVersionsLoading ? 'Loading versions...' : 'Select version...'}</option>
										{#each bulkDiffSourceVersions as version}
											<option value={version}>{version}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<!-- Target Release & Version -->
						<div>
							<label for="bulk-target-release" class="block text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Target Release & Version</label>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
								<div class="relative">
									<label for="bulk-target-release" class="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Release</label>
									<select id="bulk-target-release"
										bind:value={bulkDiffTargetReleaseName}
										on:mousedown={handleSelectOpen}
										on:focus={handleSelectOpen}
										on:blur={handleSelectClose}
										class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
										style="z-index:1000;"
									>
										<option value="">Select release...</option>
										{#each releasesConfig.releases as release}
											<option value={release.name}>{release.label}</option>
										{/each}
									</select>
								</div>
								<div class="relative">
									<label for="bulk-target-version" class="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Version</label>
									<select id="bulk-target-version"
										bind:value={bulkDiffTargetVersion}
										on:mousedown={handleSelectOpen}
										on:focus={handleSelectOpen}
										on:blur={handleSelectClose}
										class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
										style="z-index:1000;"
										disabled={!bulkDiffTargetRelease || bulkDiffTargetVersions.length === 0 || bulkDiffTargetVersionsLoading}
									>
										<option value="">{bulkDiffTargetVersionsLoading ? 'Loading versions...' : 'Select version...'}</option>
										{#each bulkDiffTargetVersions as version}
											<option value={version}>{version}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<!-- Action Buttons -->
						<div class="flex flex-col-reverse sm:flex-row justify-end gap-3 sm:gap-4 pt-6 border-t border-gray-200 dark:border-gray-700">
							<button on:click={() => showBulkDiffModal = false} class="px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base">Cancel</button>
							<button on:click={generateBulkDiffReport} disabled={!bulkDiffSourceRelease || !bulkDiffTargetRelease || !bulkDiffSourceVersion || !bulkDiffTargetVersion} class="px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base">
								{bulkDiffGenerating ? `Generating... ${bulkDiffProgress}%` : 'Generate Report'}
							</button>
						</div>
					</div>
				{:else}
					<div class="space-y-6 sm:space-y-8">
						<!-- Summary Cards -->
						<div class="grid grid-cols-2 gap-2 sm:gap-4">
							{#each [
								{status: 'added', color: 'green', icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6', label: 'Added'},
								{status: 'removed', color: 'red', icon: 'M20 12H4', label: 'Removed'},
								{status: 'modified', color: 'yellow', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Modified'},
								{status: 'unchanged', color: 'gray', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Unchanged'}
							] as item}
								<button 
									on:click={() => { 
										if (bulkDiffStatusFilter.includes(item.status)) { 
											bulkDiffStatusFilter = bulkDiffStatusFilter.filter(s => s !== item.status); 
										} else { 
											bulkDiffStatusFilter = [...bulkDiffStatusFilter, item.status]; 
										} 
									}} 
									class="bg-{item.color}-50 dark:bg-{item.color}-900/20 border-2 rounded-lg sm:rounded-xl p-3 sm:p-6 hover:shadow-lg transition-all duration-200 {bulkDiffStatusFilter.includes(item.status) ? `border-${item.color}-500 shadow-md` : `border-${item.color}-200 opacity-60 hover:opacity-100`}"
								>
									<div class="flex flex-col items-center gap-1 sm:gap-3 sm:flex-row sm:items-center">
										<div class="w-8 h-8 sm:w-10 sm:h-10 bg-{item.color}-100 dark:bg-{item.color}-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
											<svg class="h-4 w-4 sm:h-5 sm:w-5 text-{item.color}-600 dark:text-{item.color}-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon} />
											</svg>
										</div>
										<div class="text-center sm:text-left">
											<div class="text-lg sm:text-2xl font-bold text-{item.color}-600 dark:text-{item.color}-400">{bulkDiffReport.crds.filter((c: any) => c.status === item.status).length}</div>
											<div class="text-xs sm:text-sm font-medium text-{item.color}-700 dark:text-{item.color}-300">{item.label}</div>
										</div>
									</div>
								</button>
							{/each}
						</div>

						<!-- Report Info -->
						<div class="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-800 rounded-lg sm:rounded-xl p-4 sm:p-6">
							<div class="flex flex-col gap-4 sm:gap-0 sm:flex-row sm:items-center sm:justify-between">
								<div class="flex gap-3">
									<div class="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
										<svg class="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
										</svg>
									</div>
									<div class="min-w-0">
										<h3 class="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Comparison Report</h3>
										<div class="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1 flex flex-col sm:flex-row sm:items-center sm:gap-2 gap-1">
											<span class="font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs truncate">{bulkDiffReport.sourceRelease} {bulkDiffReport.sourceVersion}</span>
											<span class="hidden sm:inline text-gray-400">→</span>
											<span class="font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs truncate">{bulkDiffReport.targetRelease} {bulkDiffReport.targetVersion}</span>
										</div>
									</div>
								</div>
								<div class="flex gap-2 sm:gap-3 flex-wrap">
									<button on:click={() => downloadBulkDiffReport('json')} class="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium">JSON</button>
									<button on:click={() => downloadBulkDiffReport('text')} class="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium">TXT</button>
									<button on:click={() => downloadBulkDiffReport('markdown')} class="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm font-medium">MD</button>
								</div>
							</div>
						</div>

						<!-- Results Table -->
						<div>
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
								<h4 class="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Results</h4>
								<div class="flex items-center gap-2 sm:gap-3">
									<button on:click={() => { expandedCrdNames = filteredBulkDiffCrds.map((c: any) => c.name); }} class="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs sm:text-sm font-medium">Expand All</button>
									<button on:click={() => { expandedCrdNames = []; }} class="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs sm:text-sm font-medium">Collapse All</button>
								</div>
							</div>

							{#if filteredBulkDiffCrds.length > 0}
								<div class="overflow-x-hidden rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
									<table class="table-fixed w-full text-xs sm:text-sm">
										<colgroup>
											<col style="width: 35%" />
											<col style="width: 25%" />
											<col style="width: 20%" />
											<col style="width: 20%" />
										</colgroup>
										<thead class="bg-gray-50 dark:bg-gray-900">
											<tr>
												<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Name</th>
												<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Kind</th>
												<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Status</th>
												<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Actions</th>
											</tr>
										</thead>
										<tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
											{#each filteredBulkDiffCrds as crd}
												<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
													<td class="px-3 sm:px-6 py-3 sm:py-4 font-medium text-gray-900 dark:text-white break-words whitespace-normal">{crd.name}</td>
													<td class="px-3 sm:px-6 py-3 sm:py-4 text-gray-600 dark:text-gray-300 break-words whitespace-normal">{crd.kind}</td>
													<td class="px-3 sm:px-6 py-3 sm:py-4">
														<span class="inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium {crd.status === 'added' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : crd.status === 'removed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : crd.status === 'unchanged' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'} whitespace-nowrap">
															{#if crd.status === 'added'}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
															{:else if crd.status === 'removed'}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
															{:else if crd.status === 'modified'}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
															{:else}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
															{/if}
															{crd.status}
														</span>
													</td>
													<td class="px-3 sm:px-6 py-3 sm:py-4">
														<button 
															aria-expanded={expandedCrdNames.includes(crd.name)} 
															aria-controls={`details-${crd.name}`} 
															on:click={() => toggleCrdExpand(crd.name)} 
															class="px-2 sm:px-4 py-1.5 sm:py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
														>
															{expandedCrdNames.includes(crd.name) ? 'Hide' : 'Show'}
														</button>
													</td>
												</tr>
												{#if expandedCrdNames.includes(crd.name)}
													<tr class="bg-gray-50 dark:bg-gray-900/50">
														<td colspan="4" id={`details-${crd.name}`} class="px-3 sm:px-6 py-4 sm:py-6">
															<div class="space-y-2 sm:space-y-3">
																{#if crd.details && crd.details.length > 0}
																	<div class="space-y-2">
																		{#each crd.details as d}
																			{#if d.startsWith('+')}
																				<div class="flex items-start gap-2 sm:gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 sm:p-3">
																					<svg class="w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
																					<span class="text-green-800 dark:text-green-200 text-xs sm:text-sm break-words">{d.replace(/^\+\s*/, '')}</span>
																				</div>
																			{:else if d.startsWith('-')}
																				<div class="flex items-start gap-2 sm:gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2 sm:p-3">
																					<svg class="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
																					<span class="text-red-800 dark:text-red-200 text-xs sm:text-sm break-words">{d.replace(/^\-\s*/, '')}</span>
																				</div>
																			{:else if d.startsWith('~')}
																				<div class="flex items-start gap-2 sm:gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2 sm:p-3">
																					<svg class="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
																					<span class="text-yellow-800 dark:text-yellow-200 text-xs sm:text-sm break-words">{d.replace(/^~\s*/, '')}</span>
																				</div>
																			{:else}
																				<div class="flex items-start gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg p-2 sm:p-3">
																					<svg class="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 dark:text-gray-300 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
																					<span class="text-gray-800 dark:text-gray-200 text-xs sm:text-sm break-words">{d}</span>
																				</div>
																			{/if}
																		{/each}
																	</div>
																{:else}
																	<div class="flex items-start gap-2 sm:gap-3 text-gray-500 dark:text-gray-300">
																		<svg class="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
																		<span class="text-xs sm:text-sm italic">No additional details available.</span>
																	</div>
																{/if}
															</div>
														</td>
													</tr>
												{/if}
											{/each}
										</tbody>
									</table>
								</div>
							{:else}
								<div class="text-center py-8 sm:py-12 bg-gray-50 dark:bg-gray-900/50 rounded-lg sm:rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700">
									<div class="flex flex-col items-center gap-3 sm:gap-4">
										<div class="w-14 h-14 sm:w-16 sm:h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
											<svg class="w-7 h-7 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
											</svg>
										</div>
										<div>
											<h3 class="text-base sm:text-lg font-medium text-gray-900 dark:text-white mb-1 sm:mb-2">No Results Found</h3>
											<p class="text-gray-600 dark:text-gray-300 text-xs sm:text-sm">No CRDs match the selected filters. Try adjusting your filter criteria.</p>
										</div>
									</div>
								</div>
							{/if}

							<!-- Action Buttons -->
							<div class="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-between items-stretch sm:items-center pt-6 border-t border-gray-200 dark:border-gray-700 mt-8">
								<button on:click={() => bulkDiffReport = null} class="px-4 sm:px-6 py-2.5 sm:py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold text-sm sm:text-base">Generate New Report</button>
								<button on:click={() => { showBulkDiffModal = false; bulkDiffReport = null; }} class="px-4 sm:px-6 py-2.5 sm:py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-semibold text-sm sm:text-base">Close</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}