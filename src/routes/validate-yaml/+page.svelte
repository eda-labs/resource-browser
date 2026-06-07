<script lang="ts">
	import yaml from 'js-yaml';
	import { onMount } from 'svelte';
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
		EXAMPLE_BUNDLE_YAML,
		type BundleIssue,
		type BundleResource,
		type BundleValidationResult
	} from '$lib/validate-bundle';
	import YamlBundleEditor from '$lib/validate-bundle/YamlBundleEditor.svelte';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

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

	const manifestCache = getManifestCache();

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	$: if (browser && clientReady && release?.folder) {
		prefetchManifest(release.folder, manifestCache);
	}

	$: displayIssues = result?.issues ?? [];

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
			return;
		}
		if (!release) return;

		isValidating = true;
		highlightLine = null;

		try {
			const manifest = (await fetchManifest(release.folder, manifestCache)) || [];
			manifestResources = manifest;
			result = await validateBundle({
				yamlInput,
				releaseFolder: release.folder,
				releaseLabel: release.label,
				manifest
			});
		} catch (error) {
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
			isValidating = false;
		}
	}

	function jumpToIssue(issue: BundleIssue) {
		if (issue.line) {
			highlightLine = issue.line;
			editorRef?.focusLine(issue.line);
		}
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
				return {
					row: 'border-red-500/30 bg-red-950/30',
					badge: 'bg-red-500/20 text-red-300',
					label: 'Error'
				};
			case 'warning':
				return {
					row: 'border-amber-500/30 bg-amber-950/20',
					badge: 'bg-amber-500/20 text-amber-300',
					label: 'Warning'
				};
			default:
				return {
					row: 'border-blue-500/20 bg-blue-950/20',
					badge: 'bg-blue-500/20 text-blue-300',
					label: 'Info'
				};
		}
	}

	onMount(() => {
		const urlRelease = $page.url.searchParams.get('release');
		if (urlRelease) {
			releaseName = urlRelease;
		} else {
			const defaultRelease =
				releasesConfig.releases.find((r) => r.default) || releasesConfig.releases[0];
			if (defaultRelease) releaseName = defaultRelease.name;
		}
		clientReady = true;
		void runValidation();
	});
</script>

<svelte:head>
	<title>EDA Resource Browser | YAML Bundle Validator</title>
	<meta
		name="description"
		content="Validate multi-document Nokia EDA YAML bundles — per-resource CRD schema checks and EDA manifest rules."
	/>
</svelte:head>

<div class="validate-bundle-page page-shell min-h-full bg-slate-950 text-slate-100">
	<AppHeader fixed={false} />

	<div class="validate-bundle-main">
		<section class="validate-bundle-hero" aria-labelledby="validate-bundle-heading">
			<p class="homepage-hero-kicker">Per-resource validation</p>
			<h1 id="validate-bundle-heading" class="homepage-title text-slate-100">
				YAML Bundle Validator
			</h1>
			<p class="homepage-subtitle text-slate-400">
				Paste or upload multiple Kubernetes-style manifests (<code class="text-slate-300">---</code>
				separated). Each document is validated independently against Nokia EDA CRD schemas.
			</p>
		</section>

		<div class="validate-bundle-toolbar" role="group" aria-label="Validation options">
			<label for="validation-release" class="sr-only">Release</label>
			<select
				id="validation-release"
				bind:value={releaseName}
				on:change={() => void runValidation()}
				class="spec-search-select min-w-[10rem]"
				aria-label="Select EDA release"
			>
				<option value="">Select release…</option>
				{#each releasesConfig.releases as r}
					<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
				{/each}
			</select>

			<button
				type="button"
				class="validate-bundle-btn validate-bundle-btn--primary"
				disabled={isValidating || !release}
				on:click={() => void runValidation()}
			>
				{isValidating ? 'Validating…' : 'Validate bundle'}
			</button>

			<button
				type="button"
				class="validate-bundle-btn"
				on:click={() => {
					yamlInput = EXAMPLE_BUNDLE_YAML;
					void runValidation();
				}}
			>
				Load example
			</button>

			{#if result}
				<div class="validate-bundle-stats" role="status" aria-live="polite">
					<span>{result.summary.resourceCount} document{result.summary.resourceCount !== 1 ? 's' : ''}</span>
					<span class="text-red-400">{result.summary.errorCount} error{result.summary.errorCount !== 1 ? 's' : ''}</span>
					<span class="text-amber-400">{result.summary.warningCount} warning{result.summary.warningCount !== 1 ? 's' : ''}</span>
					{#if result.valid}
						<span class="text-green-400">All documents valid</span>
					{/if}
				</div>
			{/if}
		</div>

		<div class="validate-bundle-grid">
			<div class="validate-bundle-panel validate-bundle-panel--editor">
				<YamlBundleEditor
					bind:this={editorRef}
					bind:value={yamlInput}
					{highlightLine}
					on:validate={() => void runValidation()}
				/>
				<p class="validate-bundle-hint">Ctrl+Enter to validate · separate documents with ---</p>
			</div>

			<div class="validate-bundle-panel validate-bundle-panel--results spec-search-results-panel">
				<div class="validate-bundle-results-header">
					<h2 class="validate-bundle-results-title">Issues</h2>
					{#if result && result.summary.errorCount + result.summary.warningCount > 0}
						<span class="validate-bundle-results-badge">
							{result.summary.errorCount + result.summary.warningCount}
						</span>
					{/if}
				</div>

				<div class="validate-bundle-results-body">
					{#if !result}
						<div class="spec-search-empty">
							<p class="text-sm text-slate-400">Paste YAML and validate to see issues.</p>
						</div>
					{:else if displayIssues.length === 0}
						<div class="validate-bundle-success">
							<p>All {result.summary.resourceCount} document{result.summary.resourceCount !== 1 ? 's' : ''} passed validation.</p>
						</div>
					{:else}
						<ul class="validate-bundle-issues" role="list">
							{#each displayIssues as issue (issue.id)}
								{@const tone = severityTone(issue.severity)}
								{@const crdEntry = manifestEntryForIssue(issue)}
								<li>
									<div class="validate-bundle-issue {tone.row}">
										<button
											type="button"
											class="validate-bundle-issue-main"
											on:click={() => jumpToIssue(issue)}
										>
											<div class="validate-bundle-issue-head">
												<span class="validate-bundle-issue-badge {tone.badge}">{tone.label}</span>
												{#if issue.resourceKind}
													<span class="validate-bundle-issue-resource">
														{issue.resourceKind}{issue.resourceName ? ` / ${issue.resourceName}` : ''}
													</span>
												{/if}
												{#if issue.line}
													<span class="validate-bundle-issue-line">Line {issue.line}</span>
												{/if}
											</div>
											<p class="validate-bundle-issue-msg">{issue.message}</p>
											{#if issue.fieldPath}
												<p class="validate-bundle-issue-path">{issue.fieldPath}</p>
											{/if}
										</button>
										{#if crdEntry}
											<button
												type="button"
												class="validate-bundle-issue-schema-link"
												on:click={(e) => openCrdSchemaModal(issue, e)}
											>
												View CRD schema →
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>

		<div class="mt-4">
			<PageCredits />
		</div>
	</div>
</div>

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

<style>
	.validate-bundle-page {
		background: rgb(2 6 23);
	}

	.validate-bundle-main {
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem 1rem 2rem;
	}

	.validate-bundle-hero {
		margin-bottom: 1.25rem;
	}

	.validate-bundle-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		border: 1px solid rgb(51 65 85);
		background: rgb(15 23 42 / 0.85);
	}

	.validate-bundle-btn {
		border-radius: 0.5rem;
		border: 1px solid rgb(71 85 105);
		background: rgb(30 41 59);
		padding: 0.45rem 0.85rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: rgb(226 232 240);
	}

	.validate-bundle-btn:hover:not(:disabled) {
		background: rgb(51 65 85);
	}

	.validate-bundle-btn--primary {
		border-color: rgb(37 99 235);
		background: rgb(37 99 235);
		color: white;
	}

	.validate-bundle-btn--primary:hover:not(:disabled) {
		background: rgb(29 78 216);
	}

	.validate-bundle-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.validate-bundle-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-left: auto;
		font-size: 0.8125rem;
		font-weight: 600;
		color: rgb(148 163 184);
	}

	.validate-bundle-grid {
		display: grid;
		gap: 1rem;
	}

	@media (min-width: 1024px) {
		.validate-bundle-grid {
			grid-template-columns: 1fr 1fr;
			align-items: stretch;
		}
	}

	.validate-bundle-panel {
		min-height: 480px;
	}

	.validate-bundle-panel--results {
		display: flex;
		flex-direction: column;
		min-height: 480px;
		background: rgb(15 23 42);
		border-color: rgb(51 65 85);
	}

	.validate-bundle-hint {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: rgb(100 116 139);
	}

	.validate-bundle-results-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid rgb(51 65 85);
	}

	.validate-bundle-results-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
		color: rgb(248 250 252);
	}

	.validate-bundle-results-badge {
		border-radius: 9999px;
		background: rgb(239 68 68);
		padding: 0 0.4rem;
		font-size: 0.625rem;
		font-weight: 700;
		color: white;
		line-height: 1.25rem;
	}

	.validate-bundle-results-body {
		flex: 1;
		overflow: auto;
		padding: 0.75rem;
	}

	.validate-bundle-issues {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.validate-bundle-issue {
		width: 100%;
		border-radius: 0.5rem;
		border-width: 1px;
		padding: 0.625rem 0.75rem;
		transition: box-shadow 0.15s;
	}

	.validate-bundle-issue:hover {
		box-shadow: 0 0 0 2px rgb(59 130 246 / 0.25);
	}

	.validate-bundle-issue-main {
		width: 100%;
		text-align: left;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.validate-bundle-issue-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.5rem;
		margin-bottom: 0.35rem;
	}

	.validate-bundle-issue-badge {
		border-radius: 0.25rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.validate-bundle-issue-resource {
		font-size: 0.75rem;
		font-weight: 600;
		color: rgb(203 213 225);
	}

	.validate-bundle-issue-line {
		margin-left: auto;
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
		color: rgb(148 163 184);
	}

	.validate-bundle-issue-msg {
		font-size: 0.8125rem;
		color: rgb(226 232 240);
	}

	.validate-bundle-issue-path {
		margin-top: 0.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
		color: rgb(100 116 139);
	}

	.validate-bundle-issue-schema-link {
		margin-top: 0.35rem;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 0.6875rem;
		font-weight: 600;
		color: rgb(147 197 253);
		text-decoration: underline;
		cursor: pointer;
	}

	.validate-bundle-issue-schema-link:hover {
		color: rgb(191 219 254);
	}

	.validate-bundle-success {
		border-radius: 0.5rem;
		border: 1px solid rgb(34 197 94 / 0.35);
		background: rgb(20 83 45 / 0.25);
		padding: 1rem;
		color: rgb(134 239 172);
		font-size: 0.875rem;
	}
</style>
