<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import yaml from 'js-yaml';
	import Footer from '$lib/components/Footer.svelte';
	import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
	import TopHeader from '$lib/components/TopHeader.svelte';
	import releasesYaml from '$lib/releases.yaml?raw';
	import { stripResourcePrefixFQDN } from '$lib/components/functions';
	import type { EdaRelease, ReleasesConfig, CrdResource } from '$lib/structure';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

	// Bulk diff local state (copied from original modal implementation)
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
	let expandedCrdNames: string[] = [];
	let filteredBulkDiffCrds: any[] = [];
	let bulkDiffSearch = '';
	let bulkDiffSearchRegex = true;
	let debouncedBulkDiffSearch = '';
	let debounceTimeout: any = null;

	function handleBulkSearchInput() {
		if (debounceTimeout) clearTimeout(debounceTimeout);
		if (!bulkDiffSearchRegex) {
			debouncedBulkDiffSearch = bulkDiffSearch;
		} else {
			debounceTimeout = setTimeout(() => { debouncedBulkDiffSearch = bulkDiffSearch; }, 250);
		}
	}

	$: if (!bulkDiffSearchRegex) { if (debounceTimeout) { clearTimeout(debounceTimeout); debounceTimeout = null; } debouncedBulkDiffSearch = bulkDiffSearch; }
	let releaseAvailability: Map<string, boolean> = new Map();
	let preventDropdownClose = false;
	// Helper: escape HTML and highlight matches
	function escapeHtml(s: string) {
		const entityMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
		return String(s ?? '').replace(/[&<>"']/g, (c) => entityMap[c] ?? c);
	}

	function escapeRegExp(s: string) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	 function highlightMatches(text: string, query: string, regexMode: boolean) {
		 const q = String(query ?? '').trim();
		 if (!q) return escapeHtml(text);
		 const hay = String(text || '');
		 if (regexMode) {
			try {
				const re = new RegExp(q, 'ig');
				// Need to escape HTML first, but to replace matches, we'll split by regex and re-insert
				// We'll iterate through matches to build highlighted HTML safely
				let lastIndex = 0;
				const parts: string[] = [];
				let match: RegExpExecArray | null;
				const safeHay = escapeHtml(hay);
				// Use a plain re on unescaped hay to get accurate indices, then map to escaped string
				const rawRe = new RegExp(q, 'ig');
				while ((match = rawRe.exec(hay)) !== null) {
					const start = match.index;
					const end = rawRe.lastIndex;
					parts.push(escapeHtml(hay.substring(lastIndex, start)));
					parts.push(`<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(start, end))}</mark>`);
					lastIndex = end;
					if (rawRe.lastIndex === match.index) rawRe.lastIndex++; // avoid infinite loop
				}
				parts.push(escapeHtml(hay.substring(lastIndex)));
				return parts.join('');
			} catch (e) {
				// invalid regex, fallback to substring
				const q = String(query ?? '').trim().toLowerCase();
				const idx = hay.toLowerCase().indexOf(q);
				if (idx === -1) return escapeHtml(hay);
				return `${escapeHtml(hay.substring(0, idx))}<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(idx, idx+q.length))}</mark>${escapeHtml(hay.substring(idx+q.length))}`;
			}
		} else {
			const q = String(query ?? '').trim().toLowerCase();
			if (!q) return escapeHtml(hay);
			let result = '';
			let i = 0;
			const lower = hay.toLowerCase();
			// If query is alphanumeric only, prefer whole-word match using word boundaries
			const alphaOnly = /^[A-Za-z0-9_]+$/.test(q);
			if (alphaOnly) {
				try {
					const rawRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, 'ig');
					let lastIndex = 0;
					const parts: string[] = [];
					let match: RegExpExecArray | null;
					while ((match = rawRe.exec(hay)) !== null) {
						const start = match.index; const end = rawRe.lastIndex;
						parts.push(escapeHtml(hay.substring(lastIndex, start)));
						parts.push(`<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(start, end))}</mark>`);
						lastIndex = end;
						if (rawRe.lastIndex === match.index) rawRe.lastIndex++; // avoid infinite loop
					}
					parts.push(escapeHtml(hay.substring(lastIndex)));
					return parts.join('');
				} catch (e) {
					// fallback to substring
				}
			}
			while (true) {
				const idx = lower.indexOf(q, i);
				if (idx === -1) {
					result += escapeHtml(hay.substring(i));
					break;
				}
				result += escapeHtml(hay.substring(i, idx));
				result += `<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(idx, idx + q.length))}</mark>`;
				i = idx + q.length;
			}
			return result;
		}
	}

	// Local CRD store (we'll read manifest or fall back to resources.yaml similar to original implementation)
	let crdMetaStore: CrdResource[] = [];

	async function loadCrdsForRelease(release: EdaRelease) {
		try {
			const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
			if (manifestResponse.ok) {
				const manifest = await manifestResponse.json();
				crdMetaStore = manifest;
				return manifest as CrdResource[];
			}
		} catch (e) { }
		try {
			const res = await import('$lib/resources.yaml?raw');
			const resources = yaml.load(res.default) as any;
			const crdMeta = Object.values(resources).flat() as CrdResource[];
			crdMetaStore = crdMeta;
			return crdMeta;
		} catch (e) {
			console.error('Failed to load resources fallback', e);
			crdMetaStore = [];
			return [] as CrdResource[];
		}
	}

	async function loadVersionsForRelease(release: EdaRelease): Promise<string[]> {
		try {
			const manifestResponse = await fetch(`/${release.folder}/manifest.json`);
			if (manifestResponse.ok) {
				const manifest = await manifestResponse.json();
				const versionSet = new Set<string>();
				manifest.forEach((resource: any) => { resource.versions?.forEach((v: any) => { versionSet.add(v.name); }); });
				return Array.from(versionSet).sort();
			}
		} catch (e) { console.warn('loadVersionsForRelease failed', e); }
		return [];
	}

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

// -- Reactive statements and select focus handlers must be top-level (not inside a function) --
$: bulkDiffSourceRelease = bulkDiffSourceReleaseName ? releasesConfig.releases.find(r => r.name === bulkDiffSourceReleaseName) || null : null;
$: bulkDiffTargetRelease = bulkDiffTargetReleaseName ? releasesConfig.releases.find(r => r.name === bulkDiffTargetReleaseName) || null : null;
$: if (bulkDiffSourceRelease) loadVersionsForBulkDiffSource(); else { bulkDiffSourceVersions = []; bulkDiffSourceVersion = ''; bulkDiffSourceVersionsLoading = false; }
$: if (bulkDiffTargetRelease) loadVersionsForBulkDiffTarget(); else { bulkDiffTargetVersions = []; bulkDiffTargetVersion = ''; bulkDiffTargetVersionsLoading = false; }

function handleSelectOpen() {
	preventDropdownClose = true;
}

function handleSelectClose() {
	setTimeout(() => { preventDropdownClose = false; }, 150);
}

// Always exclude CRDs with 'states' in their name from the UI filtered results
let effectiveBulkDiffSearch = '';
$: effectiveBulkDiffSearch = bulkDiffSearchRegex ? debouncedBulkDiffSearch : bulkDiffSearch;

$: filteredBulkDiffCrds = bulkDiffReport ? bulkDiffReport.crds.filter((crd: any) => {
	if (!bulkDiffStatusFilter.includes(crd.status)) return false;
	if (crd.name.includes('states')) return false;
	const q = String(effectiveBulkDiffSearch ?? '').trim();
	if (!q) return true;
	const hay = `${crd.name} ${crd.details ? crd.details.join(' ') : ''}`;
	if (bulkDiffSearchRegex) {
		try {
			const re = new RegExp(q, 'i');
			return re.test(hay);
		} catch (e) {
			// invalid regex: fallback to substring
			return hay.toLowerCase().includes(q.toLowerCase());
		}
	} else {
		const alphaOnly = /^[A-Za-z0-9_]+$/.test(q);
		if (alphaOnly) {
			try {
				const re = new RegExp(`\\b${escapeRegExp(q)}\\b`, 'i');
				return re.test(hay);
			} catch (e) {
				// fallback to substring
			}
		}
		return hay.toLowerCase().includes(q.toLowerCase());
	}
}) : [];

// Debounce is implemented in handleBulkSearchInput to make the search reactive per keystroke

$: if (bulkDiffReport) console.debug('[diagnostic] bulk-diff page filtered count', { total: bulkDiffReport.crds.length, filtered: filteredBulkDiffCrds.length });

	onMount(() => {
		// If URL contains pre-selected params (optional)
		const urlParams = new URLSearchParams(window.location.search);
		const sr = urlParams.get('sr');
		const sv = urlParams.get('sv');
		const tr = urlParams.get('tr');
		const tv = urlParams.get('tv');
		if (sr) bulkDiffSourceReleaseName = sr;
		if (sv) bulkDiffSourceVersion = sv;
		if (tr) bulkDiffTargetReleaseName = tr;
		if (tv) bulkDiffTargetVersion = tv;
		// Resolve release objects
		bulkDiffSourceRelease = bulkDiffSourceReleaseName ? (releasesConfig.releases.find(r => r.name === bulkDiffSourceReleaseName) || null) : null;
		bulkDiffTargetRelease = bulkDiffTargetReleaseName ? (releasesConfig.releases.find(r => r.name === bulkDiffTargetReleaseName) || null) : null;
		if (bulkDiffSourceRelease) loadVersionsForBulkDiffSource();
		if (bulkDiffTargetRelease) loadVersionsForBulkDiffTarget();
		loadCrdsForRelease(releasesConfig.releases[0]);
	});

	async function checkCrdInRelease(release: EdaRelease, resourceName: string, version: string): Promise<boolean> {
		const cacheKey = `${release.name}:${resourceName}:${version}`;
		if (releaseAvailability.has(cacheKey)) { return releaseAvailability.get(cacheKey)!; }
		try { const response = await fetch(`/${release.folder}/${resourceName}/${version}.yaml`, { method: 'HEAD', cache: 'force-cache' }); const exists = response.ok; releaseAvailability.set(cacheKey, exists); return exists; } catch (error) { releaseAvailability.set(cacheKey, false); return false; }
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

	async function generateBulkDiffReport() {
		if (!bulkDiffSourceRelease || !bulkDiffTargetRelease || !bulkDiffSourceVersion || !bulkDiffTargetVersion) { alert('Please select both releases'); return; }
		bulkDiffGenerating = true; bulkDiffProgress = 0;
		const report: any = { sourceRelease: bulkDiffSourceRelease.label, sourceVersion: bulkDiffSourceVersion, targetRelease: bulkDiffTargetRelease.label, targetVersion: bulkDiffTargetVersion, generatedAt: new Date().toISOString(), crds: [] };
		// Exclude CRDs which are 'state'-only resources from the bulk comparison. These are often implementation details and noisy.
		const allCrds = crdMetaStore.filter((c: any) => !c.name.includes('states'));
		const totalCrds = allCrds.length; const batchSize = 20; const batches = [];
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
		bulkDiffReport = JSON.parse(JSON.stringify(report));
		console.debug('[diagnostic] bulk-diff page: generated report', { total: bulkDiffReport.crds.length, preview: bulkDiffReport.crds.slice(0,3) });
		bulkDiffGenerating = false;
	}

	function downloadBulkDiffReport(format: 'json' | 'text' | 'markdown' | 'csv') {
		if (!bulkDiffReport) return;
		let content = '';
		let filename = '';
		let mimeType = '';
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
			filename = `bulk-diff-${bulkDiffReport.sourceRelease}-${bulkDiffReport.sourceVersion}_to_${bulkDiffReport.targetRelease}-${bulkDiffTargetVersion}.csv`;
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

		function splitCrdName(crdName: string) {
			const withoutVersion = crdName.split('/')[0];
			const idx = withoutVersion.indexOf('.');
			if (idx === -1) return { base: withoutVersion, domain: '' };
			const base = withoutVersion.substring(0, idx);
			const domain = withoutVersion.substring(idx + 1);
			return { base, domain };
		}

	}

	// --- Spec search (search inside CRD specs for a selected release+version) ---
	let specSearchReleaseName = '';
	let specSearchRelease: EdaRelease | null = null;
	let specSearchVersion = '';
	let specSearchVersions: string[] = [];
	let specSearchLoading = false;
	let specSearchQuery = '';
	let specSearchResults: Array<{ name: string; kind?: string; snippet: string }> = [];

	$: specSearchRelease = specSearchReleaseName ? releasesConfig.releases.find(r => r.name === specSearchReleaseName) || null : null;

	async function loadSpecSearchVersions() {
		if (!specSearchRelease) { specSearchVersions = []; specSearchVersion = ''; return; }
		specSearchVersions = await loadVersionsForRelease(specSearchRelease);
		if (!specSearchVersions.includes(specSearchVersion)) specSearchVersion = '';
	}

	function stripDescriptions(obj: any): any {
		if (obj == null) return obj;
		if (Array.isArray(obj)) return obj.map(stripDescriptions);
		if (typeof obj === 'object') {
			const out: any = {};
			for (const k of Object.keys(obj)) {
				if (k === 'description') continue;
				out[k] = stripDescriptions(obj[k]);
			}
			return out;
		}
		return obj;
	}

	async function performSpecSearch() {
		specSearchResults = [];
		if (!specSearchRelease || !specSearchVersion || !specSearchQuery) return;
		specSearchLoading = true;
		try {
			// load manifest for the release
			const resp = await fetch(`/${specSearchRelease.folder}/manifest.json`);
			if (!resp.ok) {
				specSearchLoading = false;
				return;
			}
			const manifest = await resp.json();
			const q = String(specSearchQuery ?? '').trim();
			let re: RegExp | null = null;
			try { re = new RegExp(q, 'i'); } catch (e) { re = null; }

			const promises = manifest.map(async (res: any) => {
				const path = `/${specSearchRelease!.folder}/${res.name}/${specSearchVersion}.yaml`;
				try {
					const r = await fetch(path);
					if (!r.ok) return null;
					const txt = await r.text();
					// parse YAML
					const parsed = yaml.load(txt) as any;
					const specSchema = parsed?.schema?.openAPIV3Schema?.properties?.spec;
					if (!specSchema) return null;
					const stripped = stripDescriptions(specSchema);
					const hay = JSON.stringify(stripped);
					let matched = false;
					let snippet = '';
					if (re) {
						const m = re.exec(hay);
						if (m) {
							matched = true;
							const idx = m.index;
							const start = Math.max(0, idx - 80);
							const end = Math.min(hay.length, idx + (m[0]?.length || q.length) + 80);
							snippet = hay.substring(start, end);
						}
					} else {
						const idx = hay.toLowerCase().indexOf(q.toLowerCase());
						if (idx !== -1) {
							matched = true;
							const start = Math.max(0, idx - 80);
							const end = Math.min(hay.length, idx + q.length + 80);
							snippet = hay.substring(start, end);
						}
					}
					if (matched) return { name: res.name, kind: res.kind, snippet };
					return null;
				} catch (e) {
					return null;
				}
			});

			const settled = await Promise.all(promises);
			specSearchResults = settled.filter(Boolean) as any;
		} finally {
			specSearchLoading = false;
		}
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | Release Comparison</title>
</svelte:head>

<AnimatedBackground />
<TopHeader title="Release Comparison" />

<div class="relative flex flex-col lg:min-h-screen overflow-y-auto lg:overflow-hidden pt-16 md:pt-20">
	<div class="flex flex-1 flex-col lg:flex-row relative z-10">
		<div class="flex-1 overflow-auto pb-16">
			<div class="max-w-7xl mx-auto px-4 py-8">
				<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
					<!-- Title is shown in top header */ -->
				</div>

				<!-- Top banner with about/export removed per request; export controls remain in the report header -->

				<!-- Main Panel: release selection + report -->
										<div class="space-y-6 sm:space-y-8">
											<div id="comparison-description" class="mb-3 text-base text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/10 border border-gray-200 dark:border-gray-800 rounded-lg p-3">Compare CRDs across two release versions to understand additions, removals, and modifications. Use version selectors and filters below to narrow down results and generate the comparison report.</div>
					<div>
						<label for="bulk-source-release" class="block text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Source Release & Version</label>
										  <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 items-start">
											<div class="relative">
												<select id="bulk-source-release" aria-describedby="comparison-description"
													bind:value={bulkDiffSourceReleaseName}
													on:change={() => { bulkDiffSourceRelease = bulkDiffSourceReleaseName ? (releasesConfig.releases.find(r => r.name === bulkDiffSourceReleaseName) || null) : null; }}
													on:mousedown={handleSelectOpen}
													on:focus={handleSelectOpen}
													on:blur={handleSelectClose}
													class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm"
													style="z-index:1000;"
												>
									<option value="">Select release...</option>
									{#each releasesConfig.releases as r}
										<option value={r.name}>{r.label}</option>
									{/each}
								</select>
							</div>
							<div class="relative">
								<select id="bulk-source-version" aria-describedby="comparison-description" bind:value={bulkDiffSourceVersion} on:mousedown={handleSelectOpen} on:focus={handleSelectOpen} on:blur={handleSelectClose} class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm" style="z-index:1000;" disabled={!bulkDiffSourceRelease || bulkDiffSourceVersions.length === 0 || bulkDiffSourceVersionsLoading}>
									<option value="">{bulkDiffSourceVersionsLoading ? 'Loading versions...' : 'Select version...'}</option>
									{#each bulkDiffSourceVersions as version}
										<option value={version}>{version}</option>
									{/each}
								</select>
												</div>
												<!-- moved description above selectors; keep this spot empty so the grid layout remains consistent -->
						</div>
					</div>

					<div>
						<label for="bulk-target-release" class="block text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Target Release & Version</label>
												<div class="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 items-start">
													<div class="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
							<div class="relative">
								<select id="bulk-target-release" aria-describedby="comparison-description" bind:value={bulkDiffTargetReleaseName} on:change={() => { bulkDiffTargetRelease = bulkDiffTargetReleaseName ? (releasesConfig.releases.find(r => r.name === bulkDiffTargetReleaseName) || null) : null; }} on:mousedown={handleSelectOpen} on:focus={handleSelectOpen} on:blur={handleSelectClose} class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-sm" style="z-index:1000;">
									<option value="">Select release...</option>
									{#each releasesConfig.releases as r}
										<option value={r.name}>{r.label}</option>
									{/each}
								</select>
							</div>
							<div class="relative">
								<select id="bulk-target-version" aria-describedby="comparison-description" bind:value={bulkDiffTargetVersion} on:mousedown={handleSelectOpen} on:focus={handleSelectOpen} on:blur={handleSelectClose} class="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm" style="z-index:1000;" disabled={!bulkDiffTargetRelease || bulkDiffTargetVersions.length === 0 || bulkDiffTargetVersionsLoading}>
									<option value="">{bulkDiffTargetVersionsLoading ? 'Loading versions...' : 'Select version...'}</option>
									{#each bulkDiffTargetVersions as version}
										<option value={version}>{version}</option>
									{/each}
								</select>
														</div>
													</div>
													<!-- empty 3rd column placeholder to keep layout symmetrical -->
													<div class="col-span-1"></div>
												</div>
					</div>

					<div class="relative pt-4 border-t border-gray-200">
							{#if bulkDiffGenerating}
								<div class="absolute left-0 right-0 -top-1 h-1 pointer-events-none">
									<div class="w-full bg-gray-200 dark:bg-gray-700 h-1">
										<div class="bg-purple-600 h-1 rounded-full transition-all duration-300" style={`width: ${bulkDiffProgress}%`}></div>
									</div>
								</div>
							{/if}
						<div class="flex justify-between gap-3 items-center">
							<div class="flex items-center gap-2">
								<!-- left status removed: percent shown in Compare button -->
							</div>
							<div>
								<button on:click={generateBulkDiffReport} disabled={bulkDiffGenerating || !bulkDiffSourceRelease || !bulkDiffTargetRelease || !bulkDiffSourceVersion || !bulkDiffTargetVersion} class="px-4 py-2 rounded bg-purple-600 text-white">
									{#if bulkDiffGenerating}
										<span class="flex items-center gap-2">Compare <span class="text-sm font-mono ml-1">{bulkDiffProgress}%</span></span>
									{:else}
										Compare
									{/if}
								</button>
							</div>
						</div>
					</div>

					{#if bulkDiffReport}
						<!-- Summary Cards -->
						<div class="space-y-6">
							<div class="flex items-center gap-2 sm:gap-3 flex-wrap">
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
										class="flex items-center gap-2 px-2 py-1 rounded-md text-xs sm:text-sm transition-colors {bulkDiffStatusFilter.includes(item.status) ? `bg-${item.color}-100 dark:bg-${item.color}-900/30 border-${item.color}-500` : `bg-white/5 border-${item.color}-200` }"
									>
										<div class="w-6 h-6 flex items-center justify-center rounded-md bg-{item.color}-100 dark:bg-{item.color}-900/30">
											<svg class="w-4 h-4 text-{item.color}-600 dark:text-{item.color}-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.icon} /></svg>
										</div>
										<div class="font-semibold text-{item.color}-600 dark:text-{item.color}-400">{bulkDiffReport ? bulkDiffReport.crds.filter((c: any) => c.status === item.status).length : 0}</div>
										<div class="text-xs text-{item.color}-700 dark:text-{item.color}-300">{item.label}</div>
									</button>
								{/each}
							</div>

							<!-- Report Info & Exports -->
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

							<!-- Independent Search Bar (clean, pro) -->
							<div class="mb-4">
								<div class="flex items-center gap-3">
									<div class="relative flex-1">
										<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
											<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"/></svg>
										</div>
										<input id="bulk-search" bind:value={bulkDiffSearch} on:input={handleBulkSearchInput} placeholder="Search CRD name or diff (supports regex)" class="w-full rounded-lg border border-gray-300 dark:border-gray-600 pl-9 pr-10 py-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" />
										{#if bulkDiffSearch}
											<button aria-label="Clear search" on:click={() => { bulkDiffSearch = ''; debouncedBulkDiffSearch = ''; if (debounceTimeout) { clearTimeout(debounceTimeout); debounceTimeout = null; } }} class="absolute right-3 top-1/2 -translate-y-1/2 p-1 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-200">
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
											</button>
										{/if}
									</div>
									<div class="flex items-center gap-3">
										<div class="text-xs text-gray-500 dark:text-gray-400">{filteredBulkDiffCrds.length} matches</div>
									</div>
								</div>
							</div>
							<!-- Results Table -->
							<div>
								<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
									<h4 class="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Results</h4>
									<div class="flex items-center gap-2 sm:gap-3">
										<button
											on:click={() => { expandedCrdNames = expandedCrdNames.length === filteredBulkDiffCrds.length ? [] : filteredBulkDiffCrds.map((c: any) => c.name); }}
											class="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs sm:text-sm font-medium"
										>
											{#if expandedCrdNames.length === filteredBulkDiffCrds.length}
												Collapse All
											{:else}
												Expand All
											{/if}
										</button>
									</div>
								</div>

								{#if filteredBulkDiffCrds.length > 0}
									<!-- Mobile stacked cards -->
									<div class="space-y-3 sm:hidden">
										{#each filteredBulkDiffCrds as crd}
											<div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
												<div class="flex items-start justify-between gap-3">
													<div class="min-w-0 mr-2">
														<div class="text-sm font-semibold text-gray-900 dark:text-white break-words">{@html highlightMatches(stripResourcePrefixFQDN(crd.name), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</div>
														<div class="text-xs text-gray-600 dark:text-gray-300">{crd.kind}</div>
													</div>
													<div class="flex items-center gap-2">
														<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium {crd.status === 'added' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : crd.status === 'removed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : crd.status === 'unchanged' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'} whitespace-nowrap mr-2">
															{#if crd.status === 'added'}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
															{:else if crd.status === 'removed'}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
															{:else if crd.status === 'modified'}
																<div class="inline-flex items-center gap-1 mr-1">
																	<svg class="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
																	<svg class="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
																</div>
															{:else}
																<svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
															{/if}
															{crd.status}
														</span>
														<button aria-expanded={expandedCrdNames.includes(crd.name)} aria-controls={`details-${crd.name}`} on:click={() => toggleCrdExpand(crd.name)} class="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-xs font-medium">{expandedCrdNames.includes(crd.name) ? 'Hide' : 'Show'}</button>
													</div>
												</div>
												{#if expandedCrdNames.includes(crd.name)}
													<div class="mt-3 space-y-2">
														{#if crd.details && crd.details.length > 0}
															{#key debouncedBulkDiffSearch}
																{#each crd.details as d}
																{#if d.startsWith('+')}
																	<div class="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2">
																		<svg class="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
																		<span class="text-green-800 dark:text-green-200 text-xs break-words">{@html highlightMatches(d.replace(/^\+\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																	</div>
																{:else if d.startsWith('-')}
																	<div class="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">
																		<svg class="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
																		<span class="text-red-800 dark:text-red-200 text-xs break-words">{@html highlightMatches(d.replace(/^\-\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																	</div>
																{:else if d.startsWith('~')}
																	<div class="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2">
																		<svg class="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
																		<span class="text-yellow-800 dark:text-yellow-200 text-xs break-words">{@html highlightMatches(d.replace(/^~\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																	</div>
																{:else}
																	<div class="flex items-start gap-2 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg p-2">
																		<svg class="w-4 h-4 text-gray-600 dark:text-gray-300 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
																		<span class="text-gray-800 dark:text-gray-200 text-xs break-words">{d}</span>
																	</div>
																{/if}
																{/each}
															{/key}
														{:else}
															<div class="text-center py-2 text-xs text-gray-600 dark:text-gray-300">No details.</div>
														{/if}
													</div>
												{/if}
											</div>
										{/each}
									</div>

									<!-- Desktop table -->
									<div class="hidden sm:block overflow-x-auto rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
										<table class="table-auto w-full text-xs sm:text-sm">
											<thead class="bg-gray-50 dark:bg-gray-900">
												<tr>
													<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Resource</th>
													<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Status</th>
													<th class="px-3 sm:px-6 py-3 sm:py-4 font-semibold text-gray-900 dark:text-white text-left">Actions</th>
												</tr>
											</thead>
											<tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
												{#each filteredBulkDiffCrds as crd}
													<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
															<td class="px-3 sm:px-6 py-3 sm:py-4 font-medium text-gray-900 dark:text-white break-words whitespace-pre-wrap max-w-[40%]"><div class="font-semibold">{crd.kind}</div><div class="text-xs text-gray-500 dark:text-gray-300">{@html highlightMatches(stripResourcePrefixFQDN(crd.name), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</div></td>
														<td class="px-3 sm:px-6 py-3 sm:py-4">
															<span class="inline-flex items-center px-2 sm:px-3 py-1 rounded-full text-xs font-medium {crd.status === 'added' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : crd.status === 'removed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : crd.status === 'unchanged' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'} whitespace-nowrap break-words">
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
														<td class="px-3 sm:px-6 py-3 sm:py-4 max-w-[20%]">
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
																			{#key debouncedBulkDiffSearch}
																				{#each crd.details as d}
																				{#if d.startsWith('+')}
																					<div class="flex items-start gap-2 sm:gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 sm:p-3">
																						<svg class="w-4 h-4 sm:w-5 sm:h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
																						<span class="text-green-800 dark:text-green-200 text-xs sm:text-sm break-words">{@html highlightMatches(d.replace(/^\+\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																					</div>
																				{:else if d.startsWith('-')}
																					<div class="flex items-start gap-2 sm:gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2 sm:p-3">
																						<svg class="w-4 h-4 sm:w-5 sm:h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
																						<span class="text-red-800 dark:text-red-200 text-xs sm:text-sm break-words">{@html highlightMatches(d.replace(/^\-\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																					</div>
																				{:else if d.startsWith('~')}
																					<div class="flex items-start gap-2 sm:gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-2 sm:p-3">
																						<svg class="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
																						<span class="text-yellow-800 dark:text-yellow-200 text-xs sm:text-sm break-words">{@html highlightMatches(d.replace(/^~\s*[^:]+:\s*/, ''), debouncedBulkDiffSearch, bulkDiffSearchRegex)}</span>
																					</div>
																				{:else}
																					<div class="flex items-start gap-2 sm:gap-3 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg p-2 sm:p-3">
																						<svg class="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 dark:text-gray-300 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
																						<span class="text-gray-800 dark:text-gray-200 text-xs sm:text-sm break-words">{d}</span>
																					</div>
																				{/if}
																			{/each}
																		{/key}
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
									<!--< Close button removed per request -->
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<Footer />
