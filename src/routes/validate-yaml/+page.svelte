<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { CrdResource, EdaRelease, ReleasesConfig } from '$lib/structure';
	import { fetchManifest, getManifestCache, prefetchManifest, type ManifestResource } from '$lib/manifest';
	import { getLatestVersion } from '$lib/versions';
	import {
		validateBundle,
		formatYamlBundle,
		formatFixSummary,
		type FixSummary,
		applySuggestedFix,
		buildShareUrl,
		decodeBundleFromUrl,
		encodeBundleForUrl,
		getBundleParamFromSearchParams,
		EXAMPLE_BUNDLE_YAML,
		type BundleIssue,
		type BundleResource,
		type BundleValidationResult
	} from '$lib/validate-bundle';
	import YamlBundleEditor from '$lib/validate-bundle/YamlBundleEditor.svelte';
	import { clampYamlInput } from '$lib/yaml/inputLimits';
	import { loadStaticYaml } from '$lib/yaml/safeYaml';

	const releasesConfig = loadStaticYaml(releasesYaml) as ReleasesConfig;

	type IssueGroup = {
		key: string;
		label: string;
		subtitle: string | null;
		docIndex?: number;
		issues: BundleIssue[];
		errorCount: number;
		warningCount: number;
	};

	let releaseName = '';
	let release: EdaRelease | null = null;
	let yamlInput = EXAMPLE_BUNDLE_YAML;
	let result: BundleValidationResult | null = null;
	let isValidating = false;
	let clientReady = false;
	let highlightLine: number | null = null;
	let editorRef: YamlBundleEditor | undefined;
	let manifestResources: ManifestResource[] = [];
	let modalOpen = false;
	let modalResource: CrdResource | null = null;
	let modalVersion: string | null = null;
	let toast: string | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let yamlCopied = false;
	let yamlCopyTimer: ReturnType<typeof setTimeout> | null = null;
	let fixSummary: FixSummary | null = null;
	let fixSummaryTimer: ReturnType<typeof setTimeout> | null = null;
	let validationGeneration = 0;
	let issueFilter: 'all' | 'errors' | 'warnings' = 'all';
	let issueSearch = '';
	let collapsedGroups = new Set<string>();
	let yamlTruncationWarned = false;

	const manifestCache = getManifestCache();

	function setYamlInput(value: string) {
		const { text, truncated } = clampYamlInput(value);
		if (truncated && !yamlTruncationWarned) {
			yamlTruncationWarned = true;
			showToast('Input exceeds 512KB — truncated to the limit.');
		}
		if (!truncated) yamlTruncationWarned = false;
		yamlInput = text;
	}

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	$: if (browser && clientReady && release?.folder) {
		prefetchManifest(release.folder, manifestCache);
	}

	$: displayIssues = result?.issues ?? [];
	$: hasParseError = result?.issues.some((i) => i.id.startsWith('parse-')) ?? false;
	$: formatDisabled = !yamlInput.trim();
	$: formatLabel = hasParseError ? 'Fix syntax' : 'Fix manifest';
	$: formatTooltip = hasParseError
		? 'Cannot auto-fix until YAML syntax errors are resolved'
		: 'Re-indent, fix DNS names, apiVersion/kind casing, enum and boolean values, and upgrade apiVersion';

	$: filteredIssues = displayIssues.filter((issue) => {
		if (issueFilter === 'errors' && issue.severity !== 'error') return false;
		if (issueFilter === 'warnings' && issue.severity !== 'warning') return false;
		const q = issueSearch.trim().toLowerCase();
		if (!q) return true;
		return (
			issue.message.toLowerCase().includes(q) ||
			issue.resourceKind?.toLowerCase().includes(q) ||
			issue.resourceName?.toLowerCase().includes(q) ||
			issue.fieldPath?.toLowerCase().includes(q) ||
			issueCategoryLabel(issue)?.toLowerCase().includes(q)
		);
	});

	$: issueGroups = groupIssues(filteredIssues);

	function groupIssues(issues: BundleIssue[]): IssueGroup[] {
		const map = new Map<string, IssueGroup>();

		for (const issue of issues) {
			let key: string;
			let label: string;
			let subtitle: string | null = null;

			if (issue.docIndex !== undefined) {
				key = `doc-${issue.docIndex}`;
				label =
					issue.resourceKind && issue.resourceName
						? `${issue.resourceKind} / ${issue.resourceName}`
						: issue.resourceKind || `Document ${issue.docIndex}`;
				subtitle = issue.docIndex ? `Doc ${issue.docIndex}` : null;
			} else if (issue.resourceKind) {
				key = `res-${issue.resourceKind}-${issue.resourceName || 'unnamed'}`;
				label = issue.resourceKind;
				subtitle = issue.resourceName || null;
			} else {
				key = 'general';
				label = 'Bundle';
				subtitle = 'Parse & general issues';
			}

			if (!map.has(key)) {
				map.set(key, {
					key,
					label,
					subtitle,
					docIndex: issue.docIndex,
					issues: [],
					errorCount: 0,
					warningCount: 0
				});
			}

			const group = map.get(key)!;
			group.issues.push(issue);
			if (issue.severity === 'error') group.errorCount++;
			if (issue.severity === 'warning') group.warningCount++;
		}

		return Array.from(map.values()).sort((a, b) => {
			const aDoc = a.docIndex ?? Number.MAX_SAFE_INTEGER;
			const bDoc = b.docIndex ?? Number.MAX_SAFE_INTEGER;
			if (aDoc !== bDoc) return aDoc - bDoc;
			return a.label.localeCompare(b.label);
		});
	}

	function showToast(message: string) {
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast = null;
		}, 3000);
	}

	function showFixSummary(summary: FixSummary) {
		fixSummary = summary;
		if (fixSummaryTimer) clearTimeout(fixSummaryTimer);
		fixSummaryTimer = setTimeout(() => {
			fixSummary = null;
		}, 5000);
	}

	async function handleShareBundle() {
		if (!yamlInput.trim()) {
			showToast('Nothing to share — paste YAML first.');
			return;
		}
		try {
			const { param, tooLarge, encodedLength } = await encodeBundleForUrl(yamlInput);
			if (tooLarge) {
				showToast(
					`Bundle too large for URL sharing (${encodedLength} chars; ~8KB limit). Copy YAML manually.`
				);
				return;
			}
			const url = buildShareUrl(window.location.origin, releaseName, param);
			await navigator.clipboard.writeText(url);
			showToast('Share link copied to clipboard');
		} catch {
			showToast('Could not create share link');
		}
	}

	async function handleCopyYaml() {
		if (!yamlInput.trim()) return;
		try {
			await navigator.clipboard.writeText(yamlInput);
			yamlCopied = true;
			showToast('YAML copied to clipboard');
			if (yamlCopyTimer) clearTimeout(yamlCopyTimer);
			yamlCopyTimer = setTimeout(() => {
				yamlCopied = false;
			}, 2000);
		} catch {
			showToast('Could not copy YAML');
		}
	}

	async function handleFormatYaml() {
		const formatOptions =
			release && manifestResources.length
				? { releaseFolder: release.folder, manifest: manifestResources }
				: release
					? {
							releaseFolder: release.folder,
							manifest: (await fetchManifest(release.folder, manifestCache)) || []
						}
					: undefined;

		const formatResult = await formatYamlBundle(yamlInput, formatOptions);
		if (!formatResult.ok) {
			showToast(formatResult.message);
			return;
		}
		setYamlInput(formatResult.formatted);
		showFixSummary(formatFixSummary(formatResult.fixes, formatResult.docCount));
		void runValidation();
	}

	function updateURL() {
		if (!browser) return;
		const params = new URLSearchParams($page.url.searchParams);
		if (releaseName) params.set('release', releaseName);
		else params.delete('release');
		const targetUrl = `/validate-yaml${params.toString() ? `?${params.toString()}` : ''}`;
		const currentUrl = `${$page.url.pathname}${$page.url.search}`;
		if (targetUrl === currentUrl) return;
		goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let previousReleaseName = '';
	$: if (browser && clientReady && releaseName !== previousReleaseName) {
		previousReleaseName = releaseName;
		updateURL();
	}

	async function runValidation() {
		if (!yamlInput.trim()) {
			result = null;
			isValidating = false;
			return;
		}
		if (!release) return;

		const generation = ++validationGeneration;
		isValidating = true;
		highlightLine = null;

		try {
			const manifest = (await fetchManifest(release.folder, manifestCache)) || [];
			if (generation !== validationGeneration) return;

			manifestResources = manifest;
			result = await validateBundle({
				yamlInput,
				releaseFolder: release.folder,
				releaseLabel: release.label,
				manifest
			});
		} catch (error) {
			if (generation !== validationGeneration) return;
			const message = error instanceof Error ? error.message : String(error);
			result = {
				valid: false,
				issues: [
					{
						id: 'fatal',
						severity: 'error',
						category: 'schema',
						message: `Validation failed: ${message}`
					}
				],
				summary: { resourceCount: 0, errorCount: 1, warningCount: 0, infoCount: 0 },
				resources: []
			};
		} finally {
			if (generation === validationGeneration) {
				isValidating = false;
			}
		}
	}

	function jumpToIssue(issue: BundleIssue) {
		if (issue.line) {
			highlightLine = issue.line;
			editorRef?.focusLine(issue.line);
		}
	}

	function handleApplyFix(issue: BundleIssue, event: MouseEvent) {
		event.stopPropagation();
		if (!issue.suggestedFix) return;

		const updated = applySuggestedFix(yamlInput, issue);
		if (!updated) {
			showToast('Could not apply fix — edit the field manually.');
			return;
		}

		setYamlInput(updated);
		if (issue.line) {
			highlightLine = issue.line;
			editorRef?.focusLine(issue.line);
		}
		showToast(`Applied fix: ${issue.suggestedFix.field} → ${issue.suggestedFix.value}`);
		void runValidation();
	}

	function toggleGroup(key: string) {
		const next = new Set(collapsedGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		collapsedGroups = next;
	}

	function findManifestEntry(kind: string, group: string): ManifestResource | undefined {
		let entry = manifestResources.find((r) => r.kind === kind && (!r.group || r.group === group));
		if (!entry) entry = manifestResources.find((r) => r.kind === kind);
		if (!entry) {
			entry = manifestResources.find((r) => {
				const kindLower = kind.toLowerCase();
				const resourceType = r.name?.toLowerCase().split('.')[0];
				return resourceType === kindLower;
			});
		}
		return entry;
	}

	function findBundleResourceForIssue(issue: BundleIssue): BundleResource | undefined {
		if (!result) return undefined;
		if (issue.docIndex !== undefined) {
			return result.resources.find((r) => r.docIndex + 1 === issue.docIndex);
		}
		if (issue.resourceKind && issue.resourceName) {
			return result.resources.find(
				(r) => r.kind === issue.resourceKind && r.name === issue.resourceName
			);
		}
		if (issue.resourceKind) {
			return result.resources.find((r) => r.kind === issue.resourceKind);
		}
		return undefined;
	}

	function manifestEntryForIssue(issue: BundleIssue): ManifestResource | undefined {
		const bundleRes = findBundleResourceForIssue(issue);
		if (!bundleRes?.kind) return undefined;
		return findManifestEntry(bundleRes.kind, bundleRes.group);
	}

	function openCrdSchemaModal(issue: BundleIssue, event: MouseEvent) {
		event.stopPropagation();
		const entry = manifestEntryForIssue(issue);
		if (!entry || !release) return;
		modalResource = entry as CrdResource;
		modalVersion = getLatestVersion(entry);
		modalOpen = true;
	}

	function closeCrdSchemaModal() {
		modalOpen = false;
		modalResource = null;
		modalVersion = null;
	}

	function severityTone(severity: BundleIssue['severity']) {
		switch (severity) {
			case 'error':
				return { strip: 'validate-bundle-issue--error', badge: 'validate-bundle-issue-badge--error', label: 'Error' };
			case 'warning':
				return {
					strip: 'validate-bundle-issue--warning',
					badge: 'validate-bundle-issue-badge--warning',
					label: 'Warning'
				};
			default:
				return { strip: 'validate-bundle-issue--info', badge: 'validate-bundle-issue-badge--info', label: 'Info' };
		}
	}

	function issueCategoryLabel(issue: BundleIssue): string | null {
		if (issue.category === 'schema') {
			if (issue.message.startsWith('Invalid apiVersion:')) return 'Schema · apiVersion';
			if (issue.message.startsWith('Invalid kind:')) return 'Schema · kind';
			if (/\bdeprecated\b/i.test(issue.message)) return 'Schema · Deprecated';
			if (issue.message.includes('Unknown field')) return 'Schema · Unknown field';
			return 'Schema';
		}
		if (issue.category === 'eda') return 'EDA · Manifest';
		if (issue.category === 'kubernetes') return 'Kubernetes';
		return null;
	}

	onMount(async () => {
		const urlRelease = $page.url.searchParams.get('release');
		if (urlRelease) {
			releaseName = urlRelease;
		} else {
			const defaultRelease =
				releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
			if (defaultRelease) releaseName = defaultRelease.name;
		}

		const bundleParam = getBundleParamFromSearchParams($page.url.searchParams);
		if (bundleParam) {
			const decoded = await decodeBundleFromUrl(bundleParam);
			if (decoded) {
				setYamlInput(decoded);
			} else {
				showToast('Could not decode bundle from URL — using default example.');
			}
		}

		clientReady = true;
		void runValidation();
	});

	onDestroy(() => {
		if (toastTimer) clearTimeout(toastTimer);
		if (fixSummaryTimer) clearTimeout(fixSummaryTimer);
		if (yamlCopyTimer) clearTimeout(yamlCopyTimer);
	});

</script>

<svelte:head>
	<title>EDA Resource Browser | Validate YAML</title>
	<meta
		name="description"
		content="Validate multi-document Nokia EDA YAML — per-resource CRD schema checks and EDA manifest rules."
	/>
</svelte:head>

<div class="validate-yaml-page spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader fixed={false} />

	<div class="spec-search-main validate-yaml-main">
		<section class="spec-search-hero validate-yaml-hero" aria-labelledby="validate-yaml-heading">
			<p class="homepage-hero-kicker">Per-resource validation</p>
			<h1 id="validate-yaml-heading" class="homepage-title text-slate-900 dark:text-slate-100">
				Validate YAML
			</h1>
			<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
				Paste multi-document manifests (<code class="text-slate-700 dark:text-slate-300">---</code>
				separated). Each document is checked against CRD schemas, Kubernetes rules, and EDA manifest
				constraints.
			</p>
		</section>

		<div class="spec-search-filters validate-yaml-toolbar" role="group" aria-label="Validation options">
			<label for="validation-release" class="sr-only">Release</label>
			<select
				id="validation-release"
				bind:value={releaseName}
				on:change={() => void runValidation()}
				class="spec-search-select min-w-[10rem] flex-1 sm:flex-none"
				aria-label="Select EDA release"
			>
				<option value="">Select release…</option>
				{#each releasesConfig.releases as r}
					<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
				{/each}
			</select>

			<button
				type="button"
				class="validate-yaml-btn validate-yaml-btn--primary"
				disabled={isValidating || !release}
				on:click={() => void runValidation()}
			>
				{#if isValidating}
					<svg class="validate-yaml-btn__spinner animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
				{/if}
				{isValidating ? 'Validating…' : 'Validate'}
			</button>

			<button
				type="button"
				class="validate-yaml-btn"
				disabled={formatDisabled}
				title={formatTooltip}
				on:click={handleFormatYaml}
			>
				{formatLabel}
			</button>

			<button
				type="button"
				class="validate-yaml-btn validate-yaml-btn--ghost"
				on:click={() => {
					setYamlInput(EXAMPLE_BUNDLE_YAML);
					void runValidation();
				}}
			>
				Load example
			</button>

			<button
				type="button"
				class="validate-yaml-btn"
				disabled={!yamlInput.trim()}
				title="Copy a permalink with gzip-compressed YAML in the URL"
				on:click={() => void handleShareBundle()}
			>
				Share
			</button>
		</div>

		{#if fixSummary}
			<div class="validate-yaml-fix-banner" role="status" aria-live="polite">
				<p class="validate-yaml-fix-banner__headline">{fixSummary.headline}</p>
				{#if fixSummary.items.length > 0}
					<ul class="validate-yaml-fix-banner__list">
						{#each fixSummary.items as item (item.kind)}
							<li>{item.label}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if result}
			<div class="validate-yaml-stats" role="status" aria-live="polite">
				<div class="validate-yaml-stats__items">
					<span class="validate-yaml-stat">
						<span class="validate-yaml-stat__value">{result.summary.resourceCount}</span>
						doc{result.summary.resourceCount !== 1 ? 's' : ''}
					</span>
					{#if result.summary.errorCount > 0}
						<span class="validate-yaml-stat validate-yaml-stat--error">
							<span class="validate-yaml-stat__value">{result.summary.errorCount}</span>
							error{result.summary.errorCount !== 1 ? 's' : ''}
						</span>
					{/if}
					{#if result.summary.warningCount > 0}
						<span class="validate-yaml-stat validate-yaml-stat--warning">
							<span class="validate-yaml-stat__value">{result.summary.warningCount}</span>
							warning{result.summary.warningCount !== 1 ? 's' : ''}
						</span>
					{/if}
				</div>
				<span
					class="validate-yaml-status-pill"
					class:validate-yaml-status-pill--valid={result.valid}
					class:validate-yaml-status-pill--invalid={!result.valid}
				>
					{result.valid ? 'Valid' : 'Invalid'}
				</span>
				{#if isValidating}
					<span class="validate-yaml-stats__updating">Updating…</span>
				{/if}
				<button
					type="button"
					class="validate-yaml-btn validate-yaml-btn--ghost"
					disabled={!yamlInput.trim()}
					aria-label="Copy YAML to clipboard"
					on:click={() => void handleCopyYaml()}
				>
					{#if yamlCopied}
						<svg
							class="validate-yaml-btn__spinner"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/>
						</svg>
						Copied
					{:else}
						<svg
							class="validate-yaml-btn__spinner"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							/>
						</svg>
						Copy YAML
					{/if}
				</button>
			</div>
		{/if}

		<div class="validate-yaml-workspace">
			<div class="validate-yaml-panel validate-yaml-panel--editor">
				<YamlBundleEditor
					bind:this={editorRef}
					value={yamlInput}
					on:input={(e) => setYamlInput(e.detail)}
					{highlightLine}
					validating={isValidating}
					on:validate={() => void runValidation()}
				/>
			</div>

			<div class="validate-yaml-panel validate-yaml-panel--issues spec-search-results-panel">
				<div class="validate-yaml-issues-header">
					<div class="validate-yaml-issues-header__title-row">
						<h2 class="validate-yaml-issues-title">Issues</h2>
						{#if result && result.summary.errorCount + result.summary.warningCount > 0}
							<span class="validate-yaml-issues-count">
								{filteredIssues.length === displayIssues.length
									? result.summary.errorCount + result.summary.warningCount
									: `${filteredIssues.length}/${displayIssues.length}`}
							</span>
						{/if}
					</div>

					{#if displayIssues.length > 0}
						<div class="validate-yaml-issues-filters">
							<div class="validate-yaml-filter-tabs" role="tablist" aria-label="Filter issues">
								<button
									type="button"
									role="tab"
									aria-selected={issueFilter === 'all'}
									class="validate-yaml-filter-tab"
									class:validate-yaml-filter-tab--active={issueFilter === 'all'}
									on:click={() => (issueFilter = 'all')}
								>
									All
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={issueFilter === 'errors'}
									class="validate-yaml-filter-tab"
									class:validate-yaml-filter-tab--active={issueFilter === 'errors'}
									on:click={() => (issueFilter = 'errors')}
								>
									Errors
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={issueFilter === 'warnings'}
									class="validate-yaml-filter-tab"
									class:validate-yaml-filter-tab--active={issueFilter === 'warnings'}
									on:click={() => (issueFilter = 'warnings')}
								>
									Warnings
								</button>
							</div>
							<label class="validate-yaml-search">
								<span class="sr-only">Search issues</span>
								<input
									type="search"
									bind:value={issueSearch}
									placeholder="Search…"
									class="validate-yaml-search__input"
								/>
							</label>
						</div>
					{/if}
				</div>

				<div class="validate-yaml-issues-body">
					{#if !result}
						<div class="spec-search-empty">
							<div class="spec-search-empty-icon" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="h-7 w-7">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.75"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
							</div>
							<p class="text-sm text-slate-500 dark:text-slate-400">
								Paste YAML to validate against the selected release.
							</p>
						</div>
					{:else if displayIssues.length === 0}
						<div class="validate-yaml-success" role="status">
							<div class="validate-yaml-success__icon" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" class="h-6 w-6">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
							<div>
								<p class="validate-yaml-success__title">All clear</p>
								<p class="validate-yaml-success__text">
									All {result.summary.resourceCount} document{result.summary.resourceCount !== 1
										? 's'
										: ''} passed validation.
								</p>
							</div>
						</div>
					{:else if filteredIssues.length === 0}
						<div class="spec-search-empty">
							<p class="text-sm text-slate-500 dark:text-slate-400">
								No issues match the current filter.
							</p>
						</div>
					{:else}
						<div class="validate-yaml-groups">
							{#each issueGroups as group (group.key)}
								<section class="validate-yaml-group">
									<button
										type="button"
										class="validate-yaml-group__header"
										aria-expanded={!collapsedGroups.has(group.key)}
										on:click={() => toggleGroup(group.key)}
									>
										<svg
											class="validate-yaml-group__chevron"
											class:validate-yaml-group__chevron--collapsed={collapsedGroups.has(group.key)}
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 9l-7 7-7-7"
											/>
										</svg>
										<div class="validate-yaml-group__meta">
											<span class="validate-yaml-group__label">{group.label}</span>
											{#if group.subtitle && group.subtitle !== group.label}
												<span class="validate-yaml-group__subtitle">{group.subtitle}</span>
											{/if}
										</div>
										<div class="validate-yaml-group__counts">
											{#if group.errorCount > 0}
												<span class="validate-yaml-group__count validate-yaml-group__count--error">
													{group.errorCount}
												</span>
											{/if}
											{#if group.warningCount > 0}
												<span
													class="validate-yaml-group__count validate-yaml-group__count--warning"
												>
													{group.warningCount}
												</span>
											{/if}
										</div>
									</button>

									{#if !collapsedGroups.has(group.key)}
										<ul class="validate-yaml-issues" role="list">
											{#each group.issues as issue (issue.id)}
												{@const tone = severityTone(issue.severity)}
												{@const categoryLabel = issueCategoryLabel(issue)}
												{@const crdEntry = manifestEntryForIssue(issue)}
												<li>
													<div class="validate-yaml-issue {tone.strip}">
														<button
															type="button"
															class="validate-yaml-issue__main"
															on:click={() => jumpToIssue(issue)}
														>
															<div class="validate-yaml-issue__head">
																<span class="validate-yaml-issue-badge {tone.badge}">
																	{tone.label}
																</span>
																{#if categoryLabel}
																	<span class="validate-yaml-issue-category">{categoryLabel}</span>
																{/if}
																{#if issue.resourceKind && !group.label.includes(issue.resourceKind)}
																	<span class="validate-yaml-issue-resource">
																		{issue.resourceKind}{issue.resourceName
																			? ` / ${issue.resourceName}`
																			: ''}
																	</span>
																{/if}
																{#if issue.line}
																	<span class="validate-yaml-issue-line">L{issue.line}</span>
																{/if}
															</div>
															<p class="validate-yaml-issue-msg">{issue.message}</p>
															{#if issue.fieldPath}
																<p class="validate-yaml-issue-path">{issue.fieldPath}</p>
															{/if}
														</button>
														{#if issue.suggestedFix || crdEntry}
															<div class="validate-yaml-issue__actions">
																{#if issue.suggestedFix}
																	<button
																		type="button"
																		class="validate-yaml-issue-fix-link"
																		title="Replace {issue.suggestedFix.field} with {issue.suggestedFix.value}"
																		on:click={(e) => handleApplyFix(issue, e)}
																	>
																		Fix
																	</button>
																{/if}
																{#if crdEntry}
																	<button
																		type="button"
																		class="validate-yaml-issue-schema-link"
																		on:click={(e) => openCrdSchemaModal(issue, e)}
																	>
																		View CRD schema →
																	</button>
																{/if}
															</div>
														{/if}
													</div>
												</li>
											{/each}
										</ul>
									{/if}
								</section>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<PageCredits />
	</div>
</div>

{#if toast}
	<div class="validate-yaml-toast" role="status">{toast}</div>
{/if}

{#if release && modalResource}
	<ResourceModal
		open={modalOpen}
		resourceDef={modalResource}
		selectedRelease={release}
		allReleases={releasesConfig.releases}
		initialVersion={modalVersion}
		onClose={closeCrdSchemaModal}
	/>
{/if}
