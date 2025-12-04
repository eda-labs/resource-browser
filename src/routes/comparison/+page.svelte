<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import yaml from 'js-yaml';

	// AnimatedBackground is dynamically imported/rendered by the layout; avoid importing here to keep it lazy
	import TopHeader from '$lib/components/TopHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
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
			debounceTimeout = setTimeout(() => {
				debouncedBulkDiffSearch = bulkDiffSearch;
			}, 250);
		}
	}

	$: if (!bulkDiffSearchRegex) {
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			debounceTimeout = null;
		}
		debouncedBulkDiffSearch = bulkDiffSearch;
	}
	let releaseAvailability: Map<string, boolean> = new Map();
	let preventDropdownClose = false;
	// Helper: escape HTML and highlight matches
	function escapeHtml(s: string) {
		const entityMap: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		};
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
					parts.push(
						`<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(start, end))}</mark>`
					);
					lastIndex = end;
					if (rawRe.lastIndex === match.index) rawRe.lastIndex++; // avoid infinite loop
				}
				parts.push(escapeHtml(hay.substring(lastIndex)));
				return parts.join('');
			} catch (e) {
				// invalid regex, fallback to substring
				const q = String(query ?? '')
					.trim()
					.toLowerCase();
				const idx = hay.toLowerCase().indexOf(q);
				if (idx === -1) return escapeHtml(hay);
				return `${escapeHtml(hay.substring(0, idx))}<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(idx, idx + q.length))}</mark>${escapeHtml(hay.substring(idx + q.length))}`;
			}
		} else {
			const q = String(query ?? '')
				.trim()
				.toLowerCase();
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
						const start = match.index;
						const end = rawRe.lastIndex;
						parts.push(escapeHtml(hay.substring(lastIndex, start)));
						parts.push(
							`<mark class=\"bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5\">${escapeHtml(hay.substring(start, end))}</mark>`
						);
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
		} catch (e) {}
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
				manifest.forEach((resource: any) => {
					resource.versions?.forEach((v: any) => {
						versionSet.add(v.name);
					});
				});
				return Array.from(versionSet).sort();
			}
		} catch (e) {
			console.warn('loadVersionsForRelease failed', e);
		}
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
	$: bulkDiffSourceRelease = bulkDiffSourceReleaseName
		? releasesConfig.releases.find((r) => r.name === bulkDiffSourceReleaseName) || null
		: null;
	$: bulkDiffTargetRelease = bulkDiffTargetReleaseName
		? releasesConfig.releases.find((r) => r.name === bulkDiffTargetReleaseName) || null
		: null;
	$: if (bulkDiffSourceRelease) loadVersionsForBulkDiffSource();
	else {
		bulkDiffSourceVersions = [];
		bulkDiffSourceVersion = '';
		bulkDiffSourceVersionsLoading = false;
	}
	$: if (bulkDiffTargetRelease) loadVersionsForBulkDiffTarget();
	else {
		bulkDiffTargetVersions = [];
		bulkDiffTargetVersion = '';
		bulkDiffTargetVersionsLoading = false;
	}

	function handleSelectOpen() {
		preventDropdownClose = true;
	}

	function handleSelectClose() {
		setTimeout(() => {
			preventDropdownClose = false;
		}, 150);
	}

	// Always exclude CRDs with 'states' in their name from the UI filtered results
	let effectiveBulkDiffSearch = '';
	$: effectiveBulkDiffSearch = bulkDiffSearchRegex ? debouncedBulkDiffSearch : bulkDiffSearch;

	$: filteredBulkDiffCrds = bulkDiffReport
		? bulkDiffReport.crds.filter((crd: any) => {
				if (!bulkDiffStatusFilter.includes(crd.status)) return false;
				if (crd.name.includes('states')) return false;
				const q = String(effectiveBulkDiffSearch ?? '').trim();
				if (!q) return true;
				// Sanitize details to make search match more robust: remove the 'spec.' and 'status.' prefixes
				const details = crd.details
					? crd.details.map((d: string) => d.replace(/\b(spec|status)\./gi, '')).join(' ')
					: '';
				const hay = `${crd.name} ${details}`;
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
			})
		: [];

	// Debounce is implemented in handleBulkSearchInput to make the search reactive per keystroke

	$: if (bulkDiffReport)
		console.debug('[diagnostic] bulk-diff page filtered count', {
			total: bulkDiffReport.crds.length,
			filtered: filteredBulkDiffCrds.length
		});

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
		bulkDiffSourceRelease = bulkDiffSourceReleaseName
			? releasesConfig.releases.find((r) => r.name === bulkDiffSourceReleaseName) || null
			: null;
		bulkDiffTargetRelease = bulkDiffTargetReleaseName
			? releasesConfig.releases.find((r) => r.name === bulkDiffTargetReleaseName) || null
			: null;
		if (bulkDiffSourceRelease) loadVersionsForBulkDiffSource();
		if (bulkDiffTargetRelease) loadVersionsForBulkDiffTarget();
		loadCrdsForRelease(releasesConfig.releases[0]);
	});

	async function checkCrdInRelease(
		release: EdaRelease,
		resourceName: string,
		version: string
	): Promise<boolean> {
		const cacheKey = `${release.name}:${resourceName}:${version}`;
		if (releaseAvailability.has(cacheKey)) {
			return releaseAvailability.get(cacheKey)!;
		}
		try {
			const response = await fetch(`/${release.folder}/${resourceName}/${version}.yaml`, {
				method: 'HEAD',
				cache: 'force-cache'
			});
			const exists = response.ok;
			releaseAvailability.set(cacheKey, exists);
			return exists;
		} catch (error) {
			releaseAvailability.set(cacheKey, false);
			return false;
		}
	}

	function compareSchemas(sourceData: any, targetData: any): string[] {
		function compareObjects(source: any, target: any, path = ''): string[] {
			const changes: string[] = [];
			const sourceKeys = new Set(Object.keys(source || {}));
			const targetKeys = new Set(Object.keys(target || {}));
			for (const key of targetKeys) {
				if (!sourceKeys.has(key)) {
					changes.push(`+ Added: ${path}${key}`);
				}
			}
			for (const key of sourceKeys) {
				if (!targetKeys.has(key)) {
					changes.push(`- Removed: ${path}${key}`);
				}
			}
			for (const key of sourceKeys) {
				if (targetKeys.has(key)) {
					const sourceVal = source[key];
					const targetVal = target[key];
					if (
						typeof sourceVal === 'object' &&
						typeof targetVal === 'object' &&
						!Array.isArray(sourceVal) &&
						!Array.isArray(targetVal)
					) {
						changes.push(...compareObjects(sourceVal, targetVal, `${path}${key}.`));
					} else if (JSON.stringify(sourceVal) !== JSON.stringify(targetVal)) {
						changes.push(`~ Modified: ${path}${key}`);
					}
				}
			}
			return changes;
		}
		const specChanges = compareObjects(
			sourceData.schema?.openAPIV3Schema?.properties?.spec?.properties,
			targetData.schema?.openAPIV3Schema?.properties?.spec?.properties,
			'spec.'
		);
		const statusChanges = compareObjects(
			sourceData.schema?.openAPIV3Schema?.properties?.status?.properties,
			targetData.schema?.openAPIV3Schema?.properties?.status?.properties,
			'status.'
		);
		return [...specChanges, ...statusChanges];
	}

	async function generateBulkDiffReport() {
		if (
			!bulkDiffSourceRelease ||
			!bulkDiffTargetRelease ||
			!bulkDiffSourceVersion ||
			!bulkDiffTargetVersion
		) {
			alert('Please select both releases');
			return;
		}
		bulkDiffGenerating = true;
		bulkDiffProgress = 0;
		const report: any = {
			sourceRelease: bulkDiffSourceRelease.label,
			sourceVersion: bulkDiffSourceVersion,
			targetRelease: bulkDiffTargetRelease.label,
			targetVersion: bulkDiffTargetVersion,
			generatedAt: new Date().toISOString(),
			crds: []
		};
		// Exclude CRDs which are 'state'-only resources from the bulk comparison. These are often implementation details and noisy.
		const allCrds = crdMetaStore.filter((c: any) => !c.name.includes('states'));
		const totalCrds = allCrds.length;
		const batchSize = 20;
		const batches = [];
		for (let i = 0; i < allCrds.length; i += batchSize) {
			batches.push(allCrds.slice(i, i + batchSize));
		}
		for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
			const batch = batches[batchIndex];
			const batchPromises = batch.map(async (crd) => {
				try {
					const [sourceExists, targetExists] = await Promise.all([
						checkCrdInRelease(bulkDiffSourceRelease!, crd.name, bulkDiffSourceVersion),
						checkCrdInRelease(bulkDiffTargetRelease!, crd.name, bulkDiffTargetVersion)
					]);
					const crdReport: any = {
						name: crd.name,
						kind: crd.kind,
						status: '',
						hasDiff: false,
						details: []
					};
					if (!sourceExists && !targetExists) {
						crdReport.status = 'not-in-either';
						crdReport.details.push(`Not available`);
					} else if (!sourceExists) {
						crdReport.status = 'added';
						crdReport.hasDiff = true;
						crdReport.details.push(`Added`);
					} else if (!targetExists) {
						crdReport.status = 'removed';
						crdReport.hasDiff = true;
						crdReport.details.push(`Removed`);
					} else {
						const [sourceResponse, targetResponse] = await Promise.all([
							fetch(`/${bulkDiffSourceRelease!.folder}/${crd.name}/${bulkDiffSourceVersion}.yaml`),
							fetch(`/${bulkDiffTargetRelease!.folder}/${crd.name}/${bulkDiffTargetVersion}.yaml`)
						]);
						if (sourceResponse.ok && targetResponse.ok) {
							const [sourceYaml, targetYaml] = await Promise.all([
								sourceResponse.text(),
								targetResponse.text()
							]);
							const sourceData = yaml.load(sourceYaml) as any;
							const targetData = yaml.load(targetYaml) as any;
							const allChanges = compareSchemas(sourceData, targetData);
							if (allChanges.length > 0) {
								crdReport.status = 'modified';
								crdReport.hasDiff = true;
								crdReport.details = allChanges;
							} else {
								crdReport.status = 'unchanged';
								crdReport.details.push('No changes');
							}
						}
					}
					return crdReport;
				} catch (error) {
					return {
						name: crd.name,
						kind: crd.kind,
						status: 'error',
						hasDiff: false,
						details: ['Error']
					};
				}
			});
			const batchResults = await Promise.all(batchPromises);
			report.crds.push(...batchResults);
			const processedSoFar = (batchIndex + 1) * batchSize;
			bulkDiffProgress = Math.round((Math.min(processedSoFar, totalCrds) / totalCrds) * 100);
		}
		bulkDiffReport = JSON.parse(JSON.stringify(report));
		console.debug('[diagnostic] bulk-diff page: generated report', {
			total: bulkDiffReport.crds.length,
			preview: bulkDiffReport.crds.slice(0, 3)
		});
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
			rows.push(['name', 'kind', 'status', 'detail'].map(escapeCsv).join(','));
			for (const c of bulkDiffReport.crds) {
				if (c.details && c.details.length > 0) {
					for (const d of c.details) {
						rows.push(
							[escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.status), escapeCsv(d)].join(',')
						);
					}
				} else {
					rows.push(
						[escapeCsv(c.name), escapeCsv(c.kind), escapeCsv(c.status), escapeCsv('')].join(',')
					);
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
			expandedCrdNames = expandedCrdNames.filter((n) => n !== name);
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

	$: specSearchRelease = specSearchReleaseName
		? releasesConfig.releases.find((r) => r.name === specSearchReleaseName) || null
		: null;

	async function loadSpecSearchVersions() {
		if (!specSearchRelease) {
			specSearchVersions = [];
			specSearchVersion = '';
			return;
		}
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
			try {
				re = new RegExp(q, 'i');
			} catch (e) {
				re = null;
			}

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

<!-- AnimatedBackground is provided by the layout and is dynamically imported on mount -->
<TopHeader title="Release Comparison" />

<!-- Inline page description moved out of the fixed header to improve readability -->
<div class="mx-auto max-w-7xl px-3 py-2 sm:px-4">
	<div class="mx-auto w-full max-w-7xl px-3 sm:px-4 lg:px-6"></div>
</div>
<div class="relative flex h-full flex-col overflow-y-auto pt-12 md:pt-14 lg:overflow-hidden">
	<div class="relative z-10 flex flex-1 flex-col lg:flex-row">
		<div class="flex-1 overflow-auto pb-16">
			<div class="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4">
				<div
					class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
				>
					<!-- Title is shown in top header */ -->
				</div>

				<!-- Top banner with about/export removed per request; export controls remain in the report header -->

				<!-- Main Panel: release selection + report -->
				<div class="space-y-6">
					<!-- Selection Card -->
					<div
						class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-gray-700 dark:bg-gray-800"
					>
<div class="mb-6">
	<h2 class="text-xl font-bold text-blue-400 dark:text-blue-400">Compare Releases</h2>
	<p class="mt-1 text-sm text-gray-300 dark:text-gray-400">
		Select two release versions to analyze changes in Custom Resource Definitions.
	</p>
</div>						<div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
							<!-- Source -->
							<div class="relative rounded-xl bg-gray-50 p-5 dark:bg-gray-900/50">
								<div
									class="absolute -top-3 left-4 bg-blue-100 px-2 py-0.5 text-xs font-bold tracking-wide text-blue-800 uppercase rounded dark:bg-blue-900 dark:text-blue-200"
								>
									Source
								</div>
								<div class="space-y-4">
									<div>
										<label
											for="bulk-source-release"
											class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
											>Release</label
										>
										<select
											id="bulk-source-release"
											bind:value={bulkDiffSourceReleaseName}
											on:change={() => {
												bulkDiffSourceRelease = bulkDiffSourceReleaseName
													? releasesConfig.releases.find((r) => r.name === bulkDiffSourceReleaseName) ||
														null
													: null;
											}}
											class="w-full rounded-lg border-gray-300 bg-white text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
										>
											<option value="">Select release...</option>
											{#each releasesConfig.releases as r}
												<option value={r.name}>{r.label}</option>
											{/each}
										</select>
									</div>
									<div>
										<label
											for="bulk-source-version"
											class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
											>Version</label
										>
										<select
											id="bulk-source-version"
											bind:value={bulkDiffSourceVersion}
											disabled={!bulkDiffSourceRelease ||
												bulkDiffSourceVersions.length === 0 ||
												bulkDiffSourceVersionsLoading}
											class="w-full rounded-lg border-gray-300 bg-white text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
										>
											<option value=""
												>{bulkDiffSourceVersionsLoading
													? 'Loading versions...'
													: 'Select version...'}</option
											>
											{#each bulkDiffSourceVersions as version}
												<option value={version}>{version}</option>
											{/each}
										</select>
									</div>
								</div>
							</div>

							<!-- Target -->
							<div class="relative rounded-xl bg-gray-50 p-5 dark:bg-gray-900/50">
								<div
									class="absolute -top-3 left-4 bg-purple-100 px-2 py-0.5 text-xs font-bold tracking-wide text-purple-800 uppercase rounded dark:bg-purple-900 dark:text-purple-200"
								>
									Target
								</div>
								<div class="space-y-4">
									<div>
										<label
											for="bulk-target-release"
											class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
											>Release</label
										>
										<select
											id="bulk-target-release"
											bind:value={bulkDiffTargetReleaseName}
											on:change={() => {
												bulkDiffTargetRelease = bulkDiffTargetReleaseName
													? releasesConfig.releases.find((r) => r.name === bulkDiffTargetReleaseName) ||
														null
													: null;
											}}
											class="w-full rounded-lg border-gray-300 bg-white text-sm shadow-sm focus:border-purple-500 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
										>
											<option value="">Select release...</option>
											{#each releasesConfig.releases as r}
												<option value={r.name}>{r.label}</option>
											{/each}
										</select>
									</div>
									<div>
										<label
											for="bulk-target-version"
											class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
											>Version</label
										>
										<select
											id="bulk-target-version"
											bind:value={bulkDiffTargetVersion}
											disabled={!bulkDiffTargetRelease ||
												bulkDiffTargetVersions.length === 0 ||
												bulkDiffTargetVersionsLoading}
											class="w-full rounded-lg border-gray-300 bg-white text-sm shadow-sm focus:border-purple-500 focus:ring-purple-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
										>
											<option value=""
												>{bulkDiffTargetVersionsLoading
													? 'Loading versions...'
													: 'Select version...'}</option
											>
											{#each bulkDiffTargetVersions as version}
												<option value={version}>{version}</option>
											{/each}
										</select>
									</div>
								</div>
							</div>
						</div>

						<div class="mt-8 flex justify-end border-t border-gray-100 pt-6 dark:border-gray-700">
							<button
								on:click={generateBulkDiffReport}
								disabled={bulkDiffGenerating ||
									!bulkDiffSourceRelease ||
									!bulkDiffTargetRelease ||
									!bulkDiffSourceVersion ||
									!bulkDiffTargetVersion}
								class="relative inline-flex items-center justify-center rounded-lg bg-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-900"
							>
								{#if bulkDiffGenerating}
									<svg
										class="-ml-1 mr-3 h-5 w-5 animate-spin text-white"
										xmlns="http://www.w3.org/2000/svg"
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
									Generating Report ({bulkDiffProgress}%)
								{:else}
									Compare Releases
								{/if}
							</button>
						</div>
						{#if bulkDiffGenerating}
							<div class="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
								<div
									class="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out"
									style="width: {bulkDiffProgress}%"
								></div>
							</div>
						{/if}
					</div>

					{#if bulkDiffReport}
						<!-- Summary Cards -->
						<div class="space-y-6">
							<div class="flex flex-wrap items-center gap-2 sm:gap-3">
								{#each [{ status: 'added', color: 'green', icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6', label: 'Added' }, { status: 'removed', color: 'red', icon: 'M20 12H4', label: 'Removed' }, { status: 'modified', color: 'yellow', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', label: 'Modified' }, { status: 'unchanged', color: 'gray', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Unchanged' }] as item}
									<button
										on:click={() => {
											if (bulkDiffStatusFilter.includes(item.status)) {
												bulkDiffStatusFilter = bulkDiffStatusFilter.filter(
													(s) => s !== item.status
												);
											} else {
												bulkDiffStatusFilter = [...bulkDiffStatusFilter, item.status];
											}
										}}
										class="flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors sm:text-sm {bulkDiffStatusFilter.includes(
											item.status
										)
											? `bg-${item.color}-100 dark:bg-${item.color}-900/30 border-${item.color}-500`
											: `bg-white/5 border-${item.color}-200`}"
									>
										<div
											class="flex h-6 w-6 items-center justify-center rounded-md bg-{item.color}-100 dark:bg-{item.color}-900/30"
										>
											<svg
												class="h-4 w-4 text-{item.color}-600 dark:text-{item.color}-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d={item.icon}
												/></svg
											>
										</div>
										<div class="font-semibold text-{item.color}-600 dark:text-{item.color}-400">
											{bulkDiffReport
												? bulkDiffReport.crds.filter((c: any) => c.status === item.status).length
												: 0}
										</div>
										<div class="text-xs text-{item.color}-700 dark:text-{item.color}-300">
											{item.label}
										</div>
									</button>
								{/each}
							</div>

							<!-- Report Info & Exports -->
							<div
								class="rounded-lg border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-4 sm:rounded-xl sm:p-6 dark:border-purple-800 dark:from-purple-900/20 dark:to-indigo-900/20"
							>
								<div
									class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-0"
								>
									<div class="flex gap-3">
										<div
											class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 sm:h-12 sm:w-12 dark:bg-purple-900/30"
										>
											<svg
												class="h-5 w-5 text-purple-600 sm:h-6 sm:w-6 dark:text-purple-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
												/>
											</svg>
										</div>
										<div class="min-w-0">
											<h3 class="text-base font-semibold text-gray-900 sm:text-lg dark:text-white">
												Comparison Report
											</h3>
											<div
												class="mt-1 flex flex-col gap-1 text-xs text-gray-600 sm:flex-row sm:items-center sm:gap-2 sm:text-sm dark:text-gray-300"
											>
												<span
													class="truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs dark:bg-gray-800"
													>{bulkDiffReport.sourceRelease} {bulkDiffReport.sourceVersion}</span
												>
												<span class="hidden text-gray-400 sm:inline">→</span>
												<span
													class="truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs dark:bg-gray-800"
													>{bulkDiffReport.targetRelease} {bulkDiffReport.targetVersion}</span
												>
											</div>
										</div>
									</div>
									<div class="flex flex-wrap gap-2 sm:gap-3">
										<button
											on:click={() => downloadBulkDiffReport('json')}
											class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 sm:px-4 sm:text-sm"
											>JSON</button
										>
										<button
											on:click={() => downloadBulkDiffReport('text')}
											class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 sm:px-4 sm:text-sm"
											>TXT</button
										>
										<button
											on:click={() => downloadBulkDiffReport('markdown')}
											class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 sm:px-4 sm:text-sm"
											>MD</button
										>
									</div>
								</div>
							</div>

							<!-- Independent Search Bar (clean, pro) -->
							<div class="mb-4">
								<div class="flex items-center gap-3">
									<div class="relative flex-1">
										<div
											class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
										>
											<svg
												class="h-4 w-4 text-gray-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
												/></svg
											>
										</div>
										<input
											id="bulk-search"
											bind:value={bulkDiffSearch}
											on:input={handleBulkSearchInput}
											placeholder="Search CRD name or diff (supports regex)"
											class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-10 pl-9 text-sm text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
										/>
										{#if bulkDiffSearch}
											<button
												aria-label="Clear search"
												on:click={() => {
													bulkDiffSearch = '';
													debouncedBulkDiffSearch = '';
													if (debounceTimeout) {
														clearTimeout(debounceTimeout);
														debounceTimeout = null;
													}
												}}
												class="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-gray-100 p-1 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M6 18L18 6M6 6l12 12"
													/></svg
												>
											</button>
										{/if}
									</div>
									<div class="flex items-center gap-3">
										<div class="text-xs text-gray-500 dark:text-gray-400">
											{filteredBulkDiffCrds.length} matches
										</div>
									</div>
								</div>
							</div>
							<!-- Results Table -->
							<div>
								<div
									class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between"
								>
									<h4 class="text-lg font-semibold text-gray-900 sm:text-xl dark:text-white">
										Results
									</h4>
									<div class="flex items-center gap-2 sm:gap-3">
										<button
											on:click={() => {
												expandedCrdNames =
													expandedCrdNames.length === filteredBulkDiffCrds.length
														? []
														: filteredBulkDiffCrds.map((c: any) => c.name);
											}}
											class="rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 sm:px-4 sm:text-sm dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
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
											<div
												class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
											>
												<div class="flex items-start justify-between gap-3">
													<div class="mr-2 min-w-0">
														<div
															class="text-sm font-semibold break-words text-gray-900 dark:text-white"
														>
															{@html highlightMatches(
																stripResourcePrefixFQDN(crd.name),
																debouncedBulkDiffSearch,
																bulkDiffSearchRegex
															)}
														</div>
														<div class="text-xs text-gray-600 dark:text-gray-300">{crd.kind}</div>
													</div>
													<div class="flex items-center gap-2">
														<span
															class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {crd.status ===
															'added'
																? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
																: crd.status === 'removed'
																	? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
																	: crd.status === 'unchanged'
																		? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
																		: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'} mr-2 whitespace-nowrap"
														>
															{#if crd.status === 'added'}
																<svg
																	class="mr-1 h-3 w-3"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																	/></svg
																>
															{:else if crd.status === 'removed'}
																<svg
																	class="mr-1 h-3 w-3"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M20 12H4"
																	/></svg
																>
															{:else if crd.status === 'modified'}
																<div class="mr-1 inline-flex items-center gap-1">
																	<svg
																		class="h-3 w-3 text-red-600"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M20 12H4"
																		/></svg
																	>
																	<svg
																		class="h-3 w-3 text-green-600"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																		/></svg
																	>
																</div>
															{:else}
																<svg
																	class="mr-1 h-3 w-3"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
																	/></svg
																>
															{/if}
															{crd.status}
														</span>
														<button
															aria-expanded={expandedCrdNames.includes(crd.name)}
															aria-controls={`details-${crd.name}`}
															on:click={() => toggleCrdExpand(crd.name)}
															class="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
															>{expandedCrdNames.includes(crd.name) ? 'Hide' : 'Show'}</button
														>
													</div>
												</div>
												{#if expandedCrdNames.includes(crd.name)}
													<div class="mt-3 space-y-2">
														{#if crd.details && crd.details.length > 0}
															<div class="overflow-x-auto">
																<div class="grid min-w-[640px] grid-cols-1 gap-3 md:grid-cols-2">
																	<!-- SPEC changes column -->
																	<div>
																		<div class="mb-2 text-xs font-semibold text-cyan-600">SPEC</div>
																		{#key debouncedBulkDiffSearch}
																			{#each crd.details.filter((d: any) => String(d)
																					.toLowerCase()
																					.includes('spec.')) as d}
																				{#if d.startsWith('+')}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-green-800 dark:text-green-200"
																							>{@html highlightMatches(
																								d.replace(/^\+\s*[^:]+:\s*/, ''),
																								debouncedBulkDiffSearch,
																								bulkDiffSearchRegex
																							)}</span
																						>
																					</div>
																				{:else}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-600 dark:text-gray-300"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-gray-800 dark:text-gray-200"
																							>{d}</span
																						>
																					</div>
																				{/if}
																			{/each}
																		{/key}
																	</div>
																	<!-- STATUS changes column -->
																	<div>
																		<div class="mb-2 text-xs font-semibold text-green-600">
																			STATUS
																		</div>
																		{#key debouncedBulkDiffSearch}
																			{#each crd.details.filter((d: any) => String(d)
																					.toLowerCase()
																					.includes('status.')) as d}
																				{#if d.startsWith('+')}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-green-800 dark:text-green-200"
																							>{@html highlightMatches(
																								d.replace(/^\+\s*[^:]+:\s*/, ''),
																								debouncedBulkDiffSearch,
																								bulkDiffSearchRegex
																							)}</span
																						>
																					</div>
																				{:else if d.startsWith('-')}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M20 12H4"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-red-800 dark:text-red-200"
																							>{@html highlightMatches(
																								d.replace(/^\-\s*[^:]+:\s*/, ''),
																								debouncedBulkDiffSearch,
																								bulkDiffSearchRegex
																							)}</span
																						>
																					</div>
																				{:else if d.startsWith('~')}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 dark:border-yellow-800 dark:bg-yellow-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-yellow-800 dark:text-yellow-200"
																							>{@html highlightMatches(
																								d.replace(/^~\s*[^:]+:\s*/, ''),
																								debouncedBulkDiffSearch,
																								bulkDiffSearchRegex
																							)}</span
																						>
																					</div>
																				{:else}
																					<div
																						class="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/20"
																					>
																						<svg
																							class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-600 dark:text-gray-300"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																							><path
																								stroke-linecap="round"
																								stroke-linejoin="round"
																								stroke-width="2"
																								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
																							/></svg
																						>
																						<span
																							class="min-w-max text-xs break-words whitespace-pre-wrap text-gray-800 dark:text-gray-200"
																							>{d}</span
																						>
																					</div>
																				{/if}
																			{/each}
																		{/key}
																	</div>
																</div>
															</div>
														{:else}
															<div
																class="py-2 text-center text-xs text-gray-600 dark:text-gray-300"
															>
																No details.
															</div>
														{/if}
													</div>
												{/if}
											</div>
										{/each}
									</div>

									<!-- Desktop table -->
									<div
										class="hidden overflow-hidden rounded-xl border border-gray-200 shadow-sm sm:block dark:border-gray-700"
									>
										<table class="w-full table-auto text-sm">
											<thead class="bg-gray-50 dark:bg-gray-900/50">
												<tr>
													<th
														class="px-6 py-4 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
														>Resource</th
													>
													<th
														class="px-6 py-4 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
														>Status</th
													>
													<th
														class="px-6 py-4 text-right text-xs font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400"
														>Actions</th
													>
												</tr>
											</thead>
											<tbody
												class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800"
											>
												{#each filteredBulkDiffCrds as crd}
													<tr
														class="group transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
													>
														<td class="max-w-[40%] px-6 py-4">
															<div class="font-medium text-gray-900 dark:text-white">
																{crd.kind}
															</div>
															<div
																class="mt-0.5 text-xs text-gray-500 break-all dark:text-gray-400"
															>
																{@html highlightMatches(
																	stripResourcePrefixFQDN(crd.name),
																	debouncedBulkDiffSearch,
																	bulkDiffSearchRegex
																)}
															</div>
														</td>
														<td class="px-6 py-4">
															<span
																class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {crd.status ===
																'added'
																	? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
																	: crd.status === 'removed'
																		? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
																		: crd.status === 'unchanged'
																			? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
																			: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}"
															>
																{#if crd.status === 'added'}
																	<svg
																		class="-ml-0.5 mr-1.5 h-2 w-2"
																		fill="currentColor"
																		viewBox="0 0 8 8"
																	>
																		<circle cx="4" cy="4" r="3" />
																	</svg>
																{:else if crd.status === 'removed'}
																	<svg
																		class="-ml-0.5 mr-1.5 h-2 w-2"
																		fill="currentColor"
																		viewBox="0 0 8 8"
																	>
																		<circle cx="4" cy="4" r="3" />
																	</svg>
																{:else if crd.status === 'modified'}
																	<svg
																		class="-ml-0.5 mr-1.5 h-2 w-2"
																		fill="currentColor"
																		viewBox="0 0 8 8"
																	>
																		<circle cx="4" cy="4" r="3" />
																	</svg>
																{/if}
																{crd.status.charAt(0).toUpperCase() + crd.status.slice(1)}
															</span>
														</td>
														<td class="px-6 py-4 text-right">
															<button
																on:click={() => toggleCrdExpand(crd.name)}
																class="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
															>
																{expandedCrdNames.includes(crd.name)
																	? 'Hide Details'
																	: 'View Details'}
															</button>
														</td>
													</tr>
													{#if expandedCrdNames.includes(crd.name)}
														<tr class="bg-gray-50 dark:bg-gray-900/50">
															<td
																colspan="3"
																id={`details-${crd.name}`}
																class="px-3 py-4 sm:px-6 sm:py-6"
															>
																<div class="space-y-2 sm:space-y-3">
																	{#if crd.details && crd.details.length > 0}
																		<div class="space-y-2">
																			{#key debouncedBulkDiffSearch}
																				{#each crd.details as d}
																					{#if d.startsWith('+')}
																						<div
																							class="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-2 sm:gap-3 sm:p-3 dark:border-green-800 dark:bg-green-900/20"
																						>
																							<svg
																								class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 sm:h-5 sm:w-5 dark:text-green-400"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																								><path
																									stroke-linecap="round"
																									stroke-linejoin="round"
																									stroke-width="2"
																									d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																								/></svg
																							>
																							<span
																								class="text-xs break-words text-green-800 sm:text-sm dark:text-green-200"
																								>{@html highlightMatches(
																									d.replace(/^\+\s*[^:]+:\s*/, ''),
																									debouncedBulkDiffSearch,
																									bulkDiffSearchRegex
																								)}</span
																							>
																						</div>
																					{:else if d.startsWith('-')}
																						<div
																							class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 sm:gap-3 sm:p-3 dark:border-red-800 dark:bg-red-900/20"
																						>
																							<svg
																								class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 sm:h-5 sm:w-5 dark:text-red-400"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																								><path
																									stroke-linecap="round"
																									stroke-linejoin="round"
																									stroke-width="2"
																									d="M20 12H4"
																								/></svg
																							>
																							<span
																								class="text-xs break-words text-red-800 sm:text-sm dark:text-red-200"
																								>{@html highlightMatches(
																									d.replace(/^\-\s*[^:]+:\s*/, ''),
																									debouncedBulkDiffSearch,
																									bulkDiffSearchRegex
																								)}</span
																							>
																						</div>
																					{:else if d.startsWith('~')}
																						<div
																							class="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2 sm:gap-3 sm:p-3 dark:border-yellow-800 dark:bg-yellow-900/20"
																						>
																							<svg
																								class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600 sm:h-5 sm:w-5 dark:text-yellow-400"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																								><path
																									stroke-linecap="round"
																									stroke-linejoin="round"
																									stroke-width="2"
																									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																								/></svg
																							>
																							<span
																								class="text-xs break-words text-yellow-800 sm:text-sm dark:text-yellow-200"
																								>{@html highlightMatches(
																									d.replace(/^~\s*[^:]+:\s*/, ''),
																									debouncedBulkDiffSearch,
																									bulkDiffSearchRegex
																								)}</span
																							>
																						</div>
																					{:else}
																						<div
																							class="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 sm:gap-3 sm:p-3 dark:border-gray-800 dark:bg-gray-900/20"
																						>
																							<svg
																								class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-600 sm:h-5 sm:w-5 dark:text-gray-300"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																								><path
																									stroke-linecap="round"
																									stroke-linejoin="round"
																									stroke-width="2"
																									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
																								/></svg
																							>
																							<span
																								class="text-xs break-words text-gray-800 sm:text-sm dark:text-gray-200"
																								>{d}</span
																							>
																						</div>
																					{/if}
																				{/each}
																			{/key}
																		</div>
																	{:else}
																		<div
																			class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-8 text-center sm:rounded-xl sm:py-12 dark:border-gray-700 dark:bg-gray-900/50"
																		>
																			<div class="flex flex-col items-center gap-3 sm:gap-4">
																				<div
																					class="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 sm:h-16 sm:w-16 dark:bg-gray-800"
																				>
																					<svg
																						class="h-7 w-7 text-gray-400 sm:h-8 sm:w-8"
																						fill="none"
																						stroke="currentColor"
																						viewBox="0 0 24 24"
																					>
																						<path
																							stroke-linecap="round"
																							stroke-linejoin="round"
																							stroke-width="2"
																							d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
																						/>
																					</svg>
																				</div>
																				<div>
																					<h3
																						class="mb-1 text-base font-medium text-gray-900 sm:mb-2 sm:text-lg dark:text-white"
																					>
																						No Results Found
																					</h3>
																					<p
																						class="text-xs text-gray-600 sm:text-sm dark:text-gray-300"
																					>
																						No CRDs match the selected filters. Try adjusting your
																						filter criteria.
																					</p>
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
									<div
										class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-8 text-center sm:rounded-xl sm:py-12 dark:border-gray-700 dark:bg-gray-900/50"
									>
										<div class="flex flex-col items-center gap-3 sm:gap-4">
											<div
												class="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 sm:h-16 sm:w-16 dark:bg-gray-800"
											>
												<svg
													class="h-7 w-7 text-gray-400 sm:h-8 sm:w-8"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
													/>
												</svg>
											</div>
											<div>
												<h3
													class="mb-1 text-base font-medium text-gray-900 sm:mb-2 sm:text-lg dark:text-white"
												>
													No Results Found
												</h3>
												<p class="text-xs text-gray-600 sm:text-sm dark:text-gray-300">
													No CRDs match the selected filters. Try adjusting your filter criteria.
												</p>
											</div>
										</div>
									</div>
								{/if}

								<!-- Action Buttons -->
								<div
									class="mt-8 flex flex-col items-stretch justify-between gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:gap-4 dark:border-gray-700"
								>
									<button
										on:click={() => (bulkDiffReport = null)}
										class="rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 sm:px-6 sm:py-3 sm:text-base"
										>Generate New Report</button
									>
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
<!-- Page credits at bottom -->
<div class="mx-auto max-w-7xl px-4 py-6">
	<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
		<PageCredits />
	</div>
</div>
