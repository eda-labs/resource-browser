<script lang="ts">
	import yaml from 'js-yaml';
	// AnimatedBackground is dynamically imported/rendered by the layout; avoid importing here to keep it lazy
	import TopHeader from '$lib/components/TopHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';

	import Render from '$lib/components/Render.svelte';
	import YangView from '$lib/components/YangView.svelte';
	import { stripResourcePrefixFQDN } from '$lib/components/functions';
	import { expandAll, expandAllScope } from '$lib/store';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig } from '$lib/structure';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

	let releaseName = '';
	let release: EdaRelease | null = null;
	let versions: string[] = [];
	let version = '';
	let loadingVersions = false;

	let query = '';

	function ensureRenderable(schema: any) {
		if (!schema || typeof schema !== 'object') return schema;
		// If schema already has explicit type or properties/items, return as-is
		if ('type' in schema || 'properties' in schema || 'items' in schema) {
			// Common malformed wrapper: { properties: { spec: { properties: {...} }, ... } }
			// If we detect a top-level properties that contains a `spec` entry that itself
			// looks like a schema, unwrap it so the renderer shows the actual spec fields.
			try {
				if (
					schema.properties &&
					schema.properties.spec &&
					(schema.properties.spec.properties || schema.properties.spec.items)
				) {
					return ensureRenderable(schema.properties.spec);
				}
			} catch (e) {
				// ignore and fall through to return schema as-is
			}
			return schema;
		}
		// Otherwise treat the object as properties map
		try {
			return { type: 'object', properties: schema };
		} catch (e) {
			return schema;
		}
	}

	let loading = false;
	let results: Array<{
		name: string;
		kind?: string;
		schema: any;
		version?: string;
		type?: 'spec' | 'status';
	}> = [];
	// No filtering via dropdown - always show all results
	$: displayedResults = results;

	// Group results by resource name + version so we can show SPEC and STATUS together
	type GroupedResult = { name: string; kind?: string; version?: string; spec?: any; status?: any };
	let groupedResults: GroupedResult[] = [];
	$: groupedResults = (() => {
		const map = new Map<string, GroupedResult>();
		for (const r of displayedResults) {
			const key = `${r.name}::${r.version || ''}`;
			if (!map.has(key))
				map.set(key, {
					name: r.name,
					kind: r.kind,
					version: r.version,
					spec: undefined,
					status: undefined
				});
			const entry = map.get(key)!;
			if (r.type === 'spec') entry.spec = entry.spec || r.schema;
			if (r.type === 'status') entry.status = entry.status || r.schema;
		}
		return Array.from(map.values());
	})();

	// Results view mode: 'tree' shows Render, 'yang' shows dotted path view
	// Default to YANG view for search results as it's generally more compact and focused
	let resultsViewMode: 'tree' | 'yang' = 'yang';

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	async function loadVersions() {
		// Ensure we use the freshly selected release even if the reactive `release` hasn't updated yet
		const rel =
			release ||
			(releaseName ? releasesConfig.releases.find((r) => r.name === releaseName) || null : null);
		if (!rel) {
			versions = [];
			version = '';
			return;
		}
		loadingVersions = true;
		try {
			const resp = await fetch(`/${rel.folder}/manifest.json`);
			if (resp.ok) {
				const manifest = await resp.json();
				const versionSet = new Set<string>();
				manifest.forEach((resource: any) => {
					resource.versions?.forEach((v: any) => {
						if (v && v.name) versionSet.add(v.name);
					});
				});
				versions = Array.from(versionSet).sort();
			}

			// If manifest fetch failed or produced no versions, fall back to resources.yaml
			if (!versions || versions.length === 0) {
				try {
					const res = await import('$lib/resources.yaml?raw');
					const resources = yaml.load(res.default) as any;
					// resources may be an object with arrays; flatten and collect versions
					const allResources = Object.values(resources).flat();
					const fallbackSet = new Set<string>();
					allResources.forEach((r: any) => {
						r.versions?.forEach((v: any) => {
							if (v && v.name) fallbackSet.add(v.name);
						});
					});
					versions = Array.from(fallbackSet).sort();
				} catch (e) {
					// keep versions empty
					versions = [];
				}
			}

			if (!versions.includes(version)) version = '';
		} catch (e) {
			versions = [];
			version = '';
		} finally {
			loadingVersions = false;
		}
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

	// Restore description fields from original spec into a pruned/focused schema
	// `isRoot` indicates whether `node` is the top-level spec root; when true we
	// do NOT copy the root `description` (we only want parameter/property descriptions).
	function restoreDescriptions(node: any, original: any, isRoot = false) {
		if (!node || typeof node !== 'object') return node;
		if (!original || typeof original !== 'object') return node;
		try {
			if (
				!isRoot &&
				'description' in original &&
				original.description &&
				!('description' in node)
			) {
				node.description = original.description;
			}
		} catch (e) {
			// ignore
		}
		// Restore properties
		if (node.properties && original.properties) {
			for (const k of Object.keys(node.properties)) {
				try {
					node.properties[k] = restoreDescriptions(
						node.properties[k],
						original.properties ? original.properties[k] : undefined,
						false
					);
				} catch (e) {
					// ignore per-field
				}
			}
		}
		// Restore items for arrays
		if (node.items && original.items) {
			node.items = restoreDescriptions(node.items, original.items, false);
		}
		return node;
	}

	// Prune schema to include only nodes that match the query (or contain matching descendants)
	// This implementation traverses all common schema branches and returns a schema
	// containing the full ancestor path(s) down to any matching leaf nodes.
	function pruneSchema(node: any, re: RegExp | null, q: string): any | null {
		if (node == null) return null;

		// If primitive-like (no nested schema keys), test stringified value
		if (typeof node !== 'object' || (Array.isArray(node) === true && node.length === 0)) {
			const s = String(node);
			if (re ? re.test(s) : s.toLowerCase().includes(q.toLowerCase())) return node;
			return null;
		}

		const out: any = {};
		let matched = false;

		// Helper to shallow-copy useful meta (type, format, enum, default, minimum/maximum)
		function copyMeta(src: any, dst: any) {
			// Keep only small, useful metadata to avoid pulling large sibling trees.
			const keys = ['type', 'format', 'enum', 'default', 'minimum', 'maximum', 'pattern', 'title'];
			for (const k of keys) {
				if (k in src && src[k] !== undefined) dst[k] = src[k];
			}
		}

		// 1) Handle properties
		if (node.properties && typeof node.properties === 'object') {
			const props: any = {};
			for (const [pname, pval] of Object.entries(node.properties)) {
				const pr = pruneSchema(pval as any, re, q);
				if (pr != null) {
					props[pname] = pr;
					matched = true;
				} else {
					// also consider property NAME matching the query
					if (q && String(pname).toLowerCase().includes(q.toLowerCase())) {
						props[pname] = stripDescriptions(pval);
						matched = true;
					}
				}
			}
			if (Object.keys(props).length > 0) {
				out.properties = props;
				if (node.type) out.type = node.type;
			}
		}

		// 2) Handle array items
		if (node.items) {
			const pr = pruneSchema(node.items, re, q);
			if (pr != null) {
				out.items = pr;
				if (node.type) out.type = node.type;
				matched = true;
			}
		}

		// 3) Handle combiners: allOf, anyOf, oneOf
		for (const comb of ['allOf', 'anyOf', 'oneOf']) {
			if (Array.isArray(node[comb])) {
				const arr: any[] = [];
				for (const el of node[comb]) {
					const pr = pruneSchema(el, re, q);
					if (pr != null) {
						arr.push(pr);
						matched = true;
					}
				}
				if (arr.length > 0) out[comb] = arr;
			}
		}

		// 4) additionalProperties (object schema)
		if (node.additionalProperties && typeof node.additionalProperties === 'object') {
			const pr = pruneSchema(node.additionalProperties, re, q);
			if (pr != null) {
				out.additionalProperties = pr;
				matched = true;
			}
		}

		// 5) Inspect non-schema scalar fields (enum values, titles, formats, examples)
		const scalarKeys = ['enum', 'title', 'format', 'pattern', 'const'];
		for (const k of scalarKeys) {
			if (k in node && node[k] !== undefined) {
				const s = JSON.stringify(node[k]);
				if (re ? re.test(s) : s.toLowerCase().includes(q.toLowerCase())) {
					out[k] = node[k];
					matched = true;
				}
			}
		}

		// 6) If nothing matched in children, check the serialized node as a fallback
		if (!matched) {
			try {
				const hay = JSON.stringify(node);
				if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
					// return a stripped minimal node so the caller can decide how to show it
					const minimal = stripDescriptions(node);
					// avoid returning huge objects wholesale
					if (minimal && minimal.properties && Object.keys(minimal.properties).length > 30)
						return null;
					return minimal;
				}
			} catch (e) {
				// ignore
			}
			return null;
		}

		// Copy some metadata to out to preserve shape
		copyMeta(node, out);

		return out;
	}

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

	function highlightMatches(text: string, q: string) {
		const query = String(q ?? '').trim();
		if (!query) return escapeHtml(text);
		const hay = String(text || '');
		try {
			const re = new RegExp(query, 'ig');
			let lastIndex = 0;
			const parts: string[] = [];
			let match: RegExpExecArray | null;
			while ((match = re.exec(hay)) !== null) {
				const start = match.index;
				const end = re.lastIndex;
				parts.push(escapeHtml(hay.substring(lastIndex, start)));
				parts.push(
					`<mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(start, end))}</mark>`
				);
				lastIndex = end;
				if (re.lastIndex === match.index) re.lastIndex++; // guard
			}
			parts.push(escapeHtml(hay.substring(lastIndex)));
			return parts.join('');
		} catch (e) {
			// fallback substring
			const idx = hay.toLowerCase().indexOf(query.toLowerCase());
			if (idx === -1) return escapeHtml(hay);
			return `${escapeHtml(hay.substring(0, idx))}<mark class="bg-yellow-200 dark:bg-yellow-700/30 rounded px-0.5">${escapeHtml(hay.substring(idx, idx + query.length))}</mark>${escapeHtml(hay.substring(idx + query.length))}`;
		}
	}

	async function performSearch() {
		results = [];
		if (!release || !query) return;
		loading = true;
		try {
			const resp = await fetch(`/${release.folder}/manifest.json`);
			if (!resp.ok) return;
			const manifest = await resp.json();
			const q = String(query ?? '').trim();
			let re: RegExp | null = null;
			try {
				re = new RegExp(q, 'i');
			} catch (e) {
				re = null;
			}

			const promises = manifest.flatMap(async (res: any) => {
				if (!res || !res.name) return [];
				// Skip CRDs that are states
				if (String(res.name).toLowerCase().includes('states')) return [];
				// select candidate versions according to flag
				const candidateVersions = version
					? [version]
					: res.versions
						? res.versions.map((v: any) => v.name)
						: [];
				const matches: Array<any> = [];
				for (const ver of candidateVersions) {
					try {
						const path = `/${release.folder}/${res.name}/${ver}.yaml`;
						const r = await fetch(path);
						if (!r.ok) continue;
						const txt = await r.text();
						const parsed = yaml.load(txt) as any;
						const spec = parsed?.schema?.openAPIV3Schema?.properties?.spec;
						const status = parsed?.schema?.openAPIV3Schema?.properties?.status;

						// search spec
						if (spec) {
							const stripped = stripDescriptions(spec);
							const pruned = pruneSchema(stripped, re, q);
							if (pruned) {
								let readySchema = pruned;
								try {
									if (
										(!pruned.properties || Object.keys(pruned.properties).length === 0) &&
										Array.isArray(pruned.required) &&
										stripped &&
										stripped.properties
									) {
										const focusedProps: any = {};
										for (const rk of pruned.required) {
											if (rk in stripped.properties) focusedProps[rk] = stripped.properties[rk];
										}
										if (Object.keys(focusedProps).length > 0) {
											readySchema = {
												type: 'object',
												properties: focusedProps,
												required: pruned.required
											};
										}
									}
								} catch (e) {
									readySchema = pruned;
								}
								try {
									readySchema = restoreDescriptions(readySchema, spec, true);
								} catch (e) {
									/* ignore */
								}
								const ready = ensureRenderable(readySchema);
								matches.push({
									name: res.name,
									kind: res.kind,
									schema: ready,
									version: ver,
									type: 'spec'
								});
								// continue to next version; we still check status though for same version
							} else {
								try {
									const hay = JSON.stringify(stripped);
									if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
										let readySchema = spec;
										try {
											readySchema = restoreDescriptions(readySchema, spec, true);
										} catch (e) {
											/* ignore */
										}
										const ready = ensureRenderable(readySchema);
										matches.push({
											name: res.name,
											kind: res.kind,
											schema: ready,
											version: ver,
											type: 'spec'
										});
									}
								} catch (e) {
									/* ignore */
								}
							}
						}

						// search status
						if (status) {
							const strippedStatus = stripDescriptions(status);
							const prunedStatus = pruneSchema(strippedStatus, re, q);
							if (prunedStatus) {
								let readyStatus = prunedStatus;
								try {
									readyStatus = restoreDescriptions(readyStatus, status, true);
								} catch (e) {
									/* ignore */
								}
								const ensured = ensureRenderable(readyStatus);
								matches.push({
									name: res.name,
									kind: res.kind,
									schema: ensured,
									version: ver,
									type: 'status'
								});
							} else {
								try {
									const hay = JSON.stringify(strippedStatus);
									if (re ? re.test(hay) : hay.toLowerCase().includes(q.toLowerCase())) {
										let readyStatus = status;
										try {
											readyStatus = restoreDescriptions(readyStatus, status, true);
										} catch (e) {
											/* ignore */
										}
										const ensured = ensureRenderable(readyStatus);
										matches.push({
											name: res.name,
											kind: res.kind,
											schema: ensured,
											version: ver,
											type: 'status'
										});
									}
								} catch (e) {
									/* ignore */
								}
							}
						}
					} catch (e) {
						// ignore and continue to next version
					}
				}
				return matches;
			});
			const settled = await Promise.all(promises);
			results = settled.flat().filter(Boolean) as any;
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | Search CRD Specs</title>
</svelte:head>

<!-- AnimatedBackground is provided by the layout and is dynamically imported on mount -->

<TopHeader title="Search CRD Specs & Status" />

<!-- Inline page description moved out of the fixed header to improve readability -->
<div class="mx-auto max-w-7xl px-4 py-2"></div>

<!-- (PageCredits moved inside the scrolling container to render at the bottom) -->

<div
	class="relative flex flex-col overflow-y-auto pt-12 md:pt-14 lg:min-h-screen lg:overflow-hidden"
>
	<div class="relative z-10 flex flex-1 flex-col lg:flex-row">
		<div class="flex-1 overflow-auto pb-16">
			<div class="mx-auto max-w-7xl px-4 py-4">
				<div
					class="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
				>
					<!-- Header moved to TopHeader component (fixed top) -->
				</div>

				<div class="space-y-2 sm:space-y-4">
					<div>
						<p class="mb-2 text-sm leading-relaxed text-white sm:text-base">
							Select a release and version (leave the version blank to search all versions), then
							search inside CRD spec and status schemas. Descriptions are ignored to focus matches
							on parameters and values.
						</p>
						<label
							for="spec-release"
							class="mb-1 block text-base font-semibold text-gray-900 sm:mb-2 sm:text-lg dark:text-white"
							>Release & Version</label
						>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
							<div class="relative">
								<select
									id="spec-release"
									aria-label="Select release"
									bind:value={releaseName}
									on:change={loadVersions}
									class="w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500 sm:px-4 sm:py-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
									style="z-index:1000;"
								>
									<option value="">Select release...</option>
									{#each releasesConfig.releases as r}
										<option value={r.name}>{r.label}</option>
									{/each}
								</select>
							</div>
							<div class="relative">
								<select
									id="spec-version"
									aria-label="Select resource version"
									bind:value={version}
									class="w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:py-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
									style="z-index:1000;"
									disabled={!release || versions.length === 0 || loadingVersions}
								>
									<option value=""
										>{loadingVersions ? 'Loading versions...' : 'All versions'}</option
									>
									{#each versions as v}
										<option value={v}>{v}</option>
									{/each}
								</select>
							</div>
							<!-- By default we search all versions if none selected -->
						</div>

						<div class="relative pt-2">
							<!-- divider moved below search row -->
						</div>
					</div>
				</div>
				<!-- Independent Search Bar (clean, pro) like Bulk Diff (separate from result table) -->
				<div class="mb-2">
					<div class="flex items-center gap-3">
						<div class="relative flex-1">
							<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
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
								id="spec-query"
								bind:value={query}
								on:input={() => {
									/* no-op */
								}}
								on:keydown={(e) => e.key === 'Enter' && performSearch()}
								placeholder="Search specs & status (regex)"
								class="w-full rounded-lg border border-gray-300 bg-white py-3 pr-10 pl-9 text-sm text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							/>
							{#if query}
								<button
									aria-label="Clear search"
									on:click={() => {
										query = '';
										results = [];
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
							<button
								on:click={performSearch}
								class="rounded bg-purple-600 px-4 py-2 text-white"
								disabled={!release || !query || loading}
							>
								{#if loading}
									<span>Searching...</span>
								{:else}
									Search
								{/if}
							</button>
							<!-- Filter dropdown removed; all results are shown -->
							<button
								on:click={() => {
									expandAll.update((v) => {
										const nv = !v;
										expandAllScope.set('global');
										return nv;
									});
								}}
								class="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 sm:px-4 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
							>
								{#if $expandAll}Collapse All{:else}Expand All{/if}
							</button>
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">
							{groupedResults.length} matches
						</div>
						<div class="ml-3 flex items-center gap-2">
							<span class="mr-2 text-sm font-medium text-gray-900 sm:text-base dark:text-gray-200"
								>View:</span
							>
							<button
								on:click={() => (resultsViewMode = 'yang')}
								class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors sm:text-base {resultsViewMode ===
								'yang'
									? 'bg-cyan-600 text-white shadow-sm'
									: 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>YANG</button
							>
							<button
								on:click={() => (resultsViewMode = 'tree')}
								class="rounded-md px-3 py-1.5 text-sm font-semibold transition-colors sm:text-base {resultsViewMode ===
								'tree'
									? 'bg-purple-600 text-white shadow-sm'
									: 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}"
								>Tree</button
							>
						</div>
					</div>
				</div>

				<!-- Divider / progress bar under search row -->
				<div class="relative border-t border-gray-200 pt-4">
					{#if loading}
						<div class="pointer-events-none absolute -top-1 right-0 left-0 h-1">
							<div class="h-1 w-full bg-gray-200 dark:bg-gray-700">
								<div class="h-1 rounded-full bg-purple-600" style="width: 100%"></div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Results -->
				{#if displayedResults.length > 0}
					<!-- Mobile stacked grouped cards (SPEC + STATUS together) -->
					<div class="space-y-3 sm:hidden">
						{#each groupedResults as g}
							<div
								class="relative isolate z-0 overflow-hidden rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
							>
								<div class="flex items-start justify-between gap-3">
									<div class="mr-2 min-w-0">
										<div class="text-sm font-semibold break-words text-gray-900 dark:text-white">
											{g.kind}
										</div>
										<div class="text-xs text-gray-600 dark:text-gray-300">
											{stripResourcePrefixFQDN(String(g.name))}
										</div>
									</div>
									<div class="flex items-center gap-2">
										{#if g.version}
											<div
												class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
											>
												{g.version}
											</div>
										{/if}
									</div>
								</div>
								<div class="mt-3">
									<div
										class="text-xs break-words whitespace-normal text-gray-900 dark:text-gray-200"
									>
										<div class="overflow-x-auto">
											<div
												class="min-w-[640px] {g.spec && g.status
													? 'grid grid-cols-2 gap-4'
													: 'grid grid-cols-1'}"
											>
												{#if g.spec}
													<div>
														<div
															class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400"
														>
															SPEC
														</div>
														{#if resultsViewMode === 'tree'}
															<div class="relative isolate overflow-hidden">
																<Render
																	hash={`${g.name}.${g.version}.spec`}
																	source={release?.name || 'release'}
																	type={'spec'}
																	data={g.spec}
																	showType={false}
																/>
															</div>
														{:else}
															<div class="relative isolate overflow-hidden">
																<YangView
																	hash={`${g.name}.${g.version}.spec`}
																	source={release?.name || 'release'}
																	type={'spec'}
																	data={g.spec}
																	resourceName={g.name}
																	resourceVersion={g.version}
																	{releaseName}
																	kind={g.kind}
																/>
															</div>
														{/if}
													</div>
												{/if}
												{#if g.status}
													<div>
														<div
															class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400"
														>
															STATUS
														</div>
														{#if resultsViewMode === 'tree'}
															<div class="relative isolate overflow-hidden">
																<Render
																	hash={`${g.name}.${g.version}.status`}
																	source={release?.name || 'release'}
																	type={'status'}
																	data={g.status}
																	showType={false}
																/>
															</div>
														{:else}
															<div class="relative isolate overflow-hidden">
																<YangView
																	hash={`${g.name}.${g.version}.status`}
																	source={release?.name || 'release'}
																	type={'status'}
																	data={g.status}
																	resourceName={g.name}
																	resourceVersion={g.version}
																	{releaseName}
																	kind={g.kind}
																/>
															</div>
														{/if}
													</div>
												{/if}
												{#if !g.spec && !g.status}
													<div class="text-xs text-gray-500 dark:text-gray-400">
														No matching content
													</div>
												{/if}
											</div>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>

					<!-- Desktop table -->
					<div
						class="hidden overflow-x-auto rounded-lg border border-gray-200 shadow-sm sm:block sm:rounded-xl dark:border-gray-700"
					>
						<table class="w-full table-auto text-xs sm:text-sm">
							<thead class="bg-gray-50 dark:bg-gray-900">
								<tr>
									<th
										class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white"
										>Resource</th
									>
									<th
										class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white"
										>Version</th
									>
									<th
										class="px-3 py-3 text-left font-semibold text-gray-900 sm:px-6 sm:py-4 dark:text-white"
										>Match</th
									>
								</tr>
							</thead>
							<tbody
								class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800"
							>
								{#each groupedResults as g}
									<tr class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
										<td
											class="relative isolate z-0 max-w-[40%] overflow-hidden px-3 py-3 font-medium break-words whitespace-pre-wrap text-gray-900 sm:px-6 sm:py-4 dark:text-white"
											><div class="font-semibold">{g.kind}</div>
											<div class="text-xs text-gray-500 dark:text-gray-300">
												{stripResourcePrefixFQDN(String(g.name))}
											</div></td
										>
										<td
											class="relative isolate z-0 max-w-[12%] overflow-hidden px-3 py-3 break-words whitespace-pre-wrap text-gray-600 sm:px-6 sm:py-4 dark:text-gray-300"
											>{g.version}</td
										>
										<td
											class="px-3 py-3 break-words whitespace-normal text-gray-900 sm:px-6 sm:py-4 dark:text-gray-200"
										>
											<div
												class="pro-spec-preview relative isolate z-0 max-h-[40rem] overflow-hidden"
											>
												<div class="overflow-x-auto">
													<div class="min-w-[640px] space-y-4">
														{#if g.spec}
															<div>
																<div
																	class="mb-1 text-xs font-semibold text-cyan-600 dark:text-cyan-400"
																>
																	SPEC
																</div>
																{#if resultsViewMode === 'tree'}
																	<div class="relative isolate overflow-hidden">
																		<Render
																			hash={`${g.name}.${g.version}.spec`}
																			source={release?.name || 'release'}
																			type={'spec'}
																			data={g.spec}
																			showType={false}
																		/>
																	</div>
																{:else}
																	<div class="relative isolate overflow-hidden">
																		<YangView
																			hash={`${g.name}.${g.version}.spec`}
																			source={release?.name || 'release'}
																			type={'spec'}
																			data={g.spec}
																			resourceName={g.name}
																			resourceVersion={g.version}
																			{releaseName}
																			kind={g.kind}
																		/>
																	</div>
																{/if}
															</div>
														{/if}
														{#if g.status}
															<div>
																<div
																	class="mb-1 text-xs font-semibold text-green-600 dark:text-green-400"
																>
																	STATUS
																</div>
																{#if resultsViewMode === 'tree'}
																	<div class="relative isolate overflow-hidden">
																		<Render
																			hash={`${g.name}.${g.version}.status`}
																			source={release?.name || 'release'}
																			type={'status'}
																			data={g.status}
																			showType={false}
																		/>
																	</div>
																{:else}
																	<div class="relative isolate overflow-hidden">
																		<YangView
																			hash={`${g.name}.${g.version}.status`}
																			source={release?.name || 'release'}
																			type={'status'}
																			data={g.status}
																			resourceName={g.name}
																			resourceVersion={g.version}
																			{releaseName}
																			kind={g.kind}
																		/>
																	</div>
																{/if}
															</div>
														{/if}
														{#if !g.spec && !g.status}
															<div class="text-xs text-gray-500 dark:text-gray-400">
																No matching content
															</div>
														{/if}
													</div>
												</div>
											</div>
										</td>
									</tr>
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
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
									/></svg
								>
							</div>
							<div>
								<h3
									class="mb-1 text-base font-medium text-gray-900 sm:mb-2 sm:text-lg dark:text-white"
								>
									No Results Found
								</h3>
								<p class="text-xs text-gray-600 sm:text-sm dark:text-gray-300">
									No CRD spec/status matches the selected release/version (or all versions) and
									query. Try adjusting your query.
								</p>
							</div>
						</div>
					</div>
				{/if}

				<!-- Page credits at bottom of scrollable content -->
				<div class="mx-auto max-w-7xl px-4 py-6">
					<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
						<PageCredits />
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
