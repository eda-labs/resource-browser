<script lang="ts">
	import yaml from 'js-yaml';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig } from '$lib/structure';
	import type { ErrorObject } from 'ajv';
	import { fetchManifest, getManifestCache } from '$lib/manifest';
	import {
		validateYamlInput,
		prefetchManifest,
		countErrors,
		countWarnings,
		extractAllowedValues,
		extractDeprecatedValues,
		extractLocationInfo,
		extractLineNumber,
		formatErrorsForCopy,
		getErrorTone,
		hasDeprecatedFlag,
		isWarningEntry,
		stripHighlightClauses,
		type EnrichedError,
		type ValidationSummary
	} from '$lib/yaml-validation';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

	let releaseName = '';
	let release: EdaRelease | null = null;
	let yamlInput = '';
	let validationErrors: EnrichedError[] = [];
	let validationResult: 'valid' | 'invalid' | null = null;
	let isValidating = false;
	let validationSummary: ValidationSummary | null = null;
	let clientReady = false;
	let mobileTab: 'input' | 'results' = 'input';
	let copyFeedback = '';
	let yamlTextarea: HTMLTextAreaElement | undefined;

	const manifestCache = getManifestCache();

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	$: if (browser && clientReady && release?.folder) {
		prefetchManifest(release.folder, manifestCache);
	}

	function updateURL() {
		if (!browser) return;
		const params = new URLSearchParams($page.url.searchParams);
		if (releaseName) {
			params.set('release', releaseName);
		} else {
			params.delete('release');
		}
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

	function clearValidationState() {
		validationErrors = [];
		validationResult = null;
		validationSummary = null;
	}

	async function handleReleaseChange(revalidate = false) {
		clearValidationState();
		if (revalidate && yamlInput.trim() && release) {
			await runValidation();
		}
	}

	async function runValidation() {
		if (!yamlInput.trim()) {
			clearValidationState();
			return;
		}

		if (!release) {
			validationErrors = [
				{
					message: 'Please select a release first',
					instancePath: '',
					schemaPath: '',
					keyword: 'required',
					params: {}
				}
			];
			validationResult = 'invalid';
			return;
		}

		isValidating = true;
		clearValidationState();

		try {
			const manifest = (await fetchManifest(release.folder, manifestCache)) || [];
			const result = await validateYamlInput({
				yamlInput,
				releaseFolder: release.folder,
				releaseLabel: release.label,
				manifest
			});

			validationSummary = result.summary;
			validationResult = result.valid ? 'valid' : 'invalid';
			validationErrors = result.errors;

			if (browser && window.innerWidth < 1024) {
				mobileTab = 'results';
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			validationErrors = [
				{
					message: `Validation error: ${errorMessage}`,
					instancePath: '',
					schemaPath: '',
					keyword: 'format',
					params: {}
				}
			];
			validationResult = 'invalid';
		} finally {
			isValidating = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			if (!isValidating && release) void runValidation();
		}
	}

	function scrollToErrorLine(error: EnrichedError) {
		if (!yamlTextarea) return;
		const line =
			error.line ?? extractLineNumber(error.message || '') ?? undefined;
		if (!line || line < 1) {
			yamlTextarea.focus();
			return;
		}

		const lines = yamlInput.split('\n');
		let pos = 0;
		for (let i = 0; i < line - 1 && i < lines.length; i++) {
			pos += lines[i].length + 1;
		}
		const lineLen = lines[line - 1]?.length ?? 0;

		yamlTextarea.focus();
		yamlTextarea.setSelectionRange(pos, pos + lineLen);

		const lineHeight = 20;
		yamlTextarea.scrollTop = Math.max(0, (line - 3) * lineHeight);
		mobileTab = 'input';
	}

	async function copyAllErrors() {
		const text = formatErrorsForCopy(validationErrors);
		if (!text || !browser) return;
		try {
			await navigator.clipboard.writeText(text);
			copyFeedback = 'Copied!';
			setTimeout(() => {
				copyFeedback = '';
			}, 2000);
		} catch {
			copyFeedback = 'Copy failed';
		}
	}

	function crdDetailHref(error: EnrichedError): string | null {
		if (!error.resourceLink || !releaseName) return null;
		return `/${error.resourceLink.name}/${error.resourceLink.version}?release=${encodeURIComponent(releaseName)}`;
	}

	function isKindOrApiError(error: EnrichedError): boolean {
		const path = error.instancePath || '';
		return path === '/kind' || path === '/apiVersion';
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
	});
</script>

<svelte:head>
	<title>EDA Resource Browser | YAML Validation</title>
	<meta
		name="description"
		content="Validate Nokia EDA CRD YAML against release schemas — check apiVersion, kind, metadata, spec, and status fields."
	/>
</svelte:head>

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader contextTitle="YAML Validation" contextBadge="Validate" fixed={false} />

	<div class="spec-search-main">
		<section class="spec-search-hero" aria-labelledby="validate-yaml-heading">
			<p class="homepage-hero-kicker">Configuration check</p>
			<h1 id="validate-yaml-heading" class="homepage-title text-slate-900 dark:text-slate-100">
				Validate CRD YAML
			</h1>
			<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
				Paste one or more Kubernetes-style documents and validate them against Nokia EDA CRD schemas
				for the selected release.
			</p>
		</section>

		<div class="spec-search-filters" role="group" aria-label="Validation options">
			<label for="validation-release" class="sr-only">Release</label>
			<select
				id="validation-release"
				bind:value={releaseName}
				on:change={() => handleReleaseChange(yamlInput.trim().length > 0)}
				class="spec-search-select min-w-[10rem] flex-1 sm:flex-none"
				aria-label="Select EDA release"
			>
				<option value="">Select release…</option>
				{#each releasesConfig.releases as r}
					<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
				{/each}
			</select>

			{#if release}
				<span
					class="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400"
					aria-live="polite"
				>
					{release.label}
				</span>
			{/if}
		</div>

		<!-- Mobile tab switcher -->
		<div class="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 lg:hidden dark:border-slate-600 dark:bg-slate-800/80" role="tablist" aria-label="Input and results">
			<button
				type="button"
				role="tab"
				aria-selected={mobileTab === 'input'}
				class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {mobileTab === 'input'
					? 'bg-blue-600 text-white'
					: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
				on:click={() => (mobileTab = 'input')}
			>
				Input
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={mobileTab === 'results'}
				class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {mobileTab === 'results'
					? 'bg-blue-600 text-white'
					: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
				on:click={() => (mobileTab = 'results')}
			>
				Results
				{#if validationSummary && validationSummary.totalErrors > 0}
					<span class="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
						{validationSummary.totalErrors}
					</span>
				{/if}
			</button>
		</div>

		<div class="grid gap-4 lg:grid-cols-2 lg:gap-6">
			<!-- Input panel -->
			<div
				class="spec-search-results-panel {mobileTab !== 'input' ? 'hidden lg:block' : ''}"
				role="tabpanel"
				aria-label="YAML input"
			>
				<div class="border-b border-slate-200 px-4 py-3 dark:border-slate-600 md:px-5 md:py-4">
					<h2 class="text-base font-bold text-slate-900 md:text-lg dark:text-slate-100">YAML Input</h2>
					<p class="text-xs text-slate-500 dark:text-slate-400">
						Paste CRD configurations — separate multiple documents with <code class="text-[11px]">---</code>
					</p>
				</div>

				<div class="p-4 md:p-5">
					<div class="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs dark:border-slate-600 dark:bg-slate-800/50">
						<h3 class="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
							Validation policy
						</h3>
						<ul class="space-y-1 text-slate-600 dark:text-slate-300">
							<li>
								<strong>Spec:</strong> validated against the newest API version schema for each CRD
								in the selected release
							</li>
							<li>
								<strong>Deprecated apiVersion:</strong> reported as a
								<span class="font-medium text-amber-700 dark:text-amber-300">warning</span>, not a
								hard error
							</li>
							<li><strong>Unsupported apiVersion:</strong> hard error with allowed versions listed</li>
							<li><strong>status</strong> is optional — invalid status generates warnings only</li>
						</ul>
					</div>

					<label for="yaml-input" class="sr-only">YAML input</label>
					<textarea
						id="yaml-input"
						bind:this={yamlTextarea}
						bind:value={yamlInput}
						on:keydown={handleKeydown}
						placeholder="apiVersion: protocols.eda.nokia.com/v1alpha1
kind: BgpPeer
metadata:
  name: my-bgp-peer
spec:
  peerAddress: 192.168.1.1
  peerAs: 65001"
						class="min-h-[320px] w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 hover:border-blue-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-500 dark:focus:border-blue-400 dark:focus:bg-slate-800 lg:min-h-[400px]"
						aria-describedby="validate-hint"
					></textarea>

					<div class="mt-3 flex flex-wrap items-center gap-2">
						<button
							type="button"
							on:click={runValidation}
							disabled={isValidating || !release}
							aria-busy={isValidating}
							aria-label="Validate YAML configuration"
							class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
						>
							{#if isValidating}
								<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
								</svg>
								<span>Validating…</span>
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<span>Validate YAML</span>
							{/if}
						</button>

						{#if !release}
							<p id="validate-hint" class="text-xs text-amber-700 dark:text-amber-300">
								Select a release to enable validation
							</p>
						{:else}
							<p id="validate-hint" class="text-xs text-slate-500 dark:text-slate-400">
								Ctrl+Enter to validate
							</p>
						{/if}

						{#if yamlInput}
							<button
								type="button"
								on:click={() => {
									yamlInput = '';
									clearValidationState();
								}}
								class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
							>
								Clear
							</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Results panel -->
			<div
				class="spec-search-results-panel {mobileTab !== 'results' ? 'hidden lg:block' : ''}"
				role="tabpanel"
				aria-label="Validation results"
			>
				<div class="border-b border-slate-200 px-4 py-3 dark:border-slate-600 md:px-5 md:py-4">
					<div class="flex items-start justify-between gap-2">
						<div>
							<h2 class="text-base font-bold text-slate-900 md:text-lg dark:text-slate-100">
								Validation Results
							</h2>
							<p class="text-xs text-slate-500 dark:text-slate-400">
								Click an error to jump to its line in the editor
							</p>
						</div>
						{#if validationErrors.length > 0 && validationResult === 'invalid'}
							<button
								type="button"
								on:click={copyAllErrors}
								class="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
								aria-label="Copy all errors to clipboard"
							>
								{copyFeedback || 'Copy errors'}
							</button>
						{/if}
					</div>
				</div>

				<div class="p-4 md:p-5" aria-live="polite" aria-relevant="additions text">
					{#if validationSummary}
						<div
							class="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-600 dark:bg-slate-900 md:grid-cols-4 lg:sticky lg:top-2 lg:z-10"
							role="status"
						>
							<div>
								<p class="text-slate-500 dark:text-slate-400">Documents</p>
								<p class="font-semibold text-slate-900 dark:text-slate-100">
									{validationSummary.totalDocs}
								</p>
							</div>
							<div>
								<p class="text-green-600 dark:text-green-400">Valid</p>
								<p class="font-semibold text-green-700 dark:text-green-300">
									{validationSummary.validDocs}
								</p>
							</div>
							<div>
								<p class="text-red-600 dark:text-red-400">Docs With Errors</p>
								<p class="font-semibold text-red-700 dark:text-red-300">
									{validationSummary.docsWithErrors}
								</p>
							</div>
							<div>
								<p class="text-yellow-600 dark:text-yellow-400">Docs With Warnings</p>
								<p class="font-semibold text-yellow-700 dark:text-yellow-300">
									{validationSummary.docsWithWarnings}
								</p>
							</div>
						</div>
					{/if}

					{#if validationErrors.length > 0}
						{#if validationResult === 'valid'}
							<div class="space-y-3 rounded-lg border border-green-200 bg-green-50/80 p-3 md:p-4 dark:border-green-800 dark:bg-green-900/20">
								<div class="flex items-start gap-2 md:gap-3">
									<svg class="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 md:h-6 md:w-6 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<div class="flex-1">
										<p class="text-sm font-semibold text-green-900 md:text-base dark:text-green-100">
											{validationErrors[0].message}
										</p>
										{#if validationErrors.length > 1}
											<div class="mt-3 space-y-2">
												<p class="text-xs font-medium text-yellow-800 dark:text-yellow-300">Warnings:</p>
												{#each validationErrors.slice(1) as error}
													<div class="flex items-start gap-2 rounded-md bg-yellow-50/50 p-2 dark:bg-yellow-900/10">
														<p class="text-xs text-yellow-800 dark:text-yellow-200">{error.message}</p>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							</div>
						{:else}
							<div class="rounded-lg border border-red-200 bg-red-50/50 p-3 md:p-4 dark:border-red-800 dark:bg-red-900/20">
								<h4 class="mb-2 text-sm font-semibold text-red-900 md:text-base dark:text-red-100">
									Validation Failed ({countErrors(validationErrors as ErrorObject[])} error{countErrors(validationErrors as ErrorObject[]) !== 1 ? 's' : ''}{countWarnings(validationErrors as ErrorObject[]) > 0
										? `, ${countWarnings(validationErrors as ErrorObject[])} warning${countWarnings(validationErrors as ErrorObject[]) !== 1 ? 's' : ''}`
										: ''})
								</h4>
								<ul class="space-y-2" role="list">
									{#each validationErrors as error}
										{@const tone = getErrorTone(error as ErrorObject)}
										{@const rawMessage = error.message || ''}
										{@const cleanMessage = stripHighlightClauses(rawMessage)}
										{@const allowedValues = extractAllowedValues(rawMessage)}
										{@const deprecatedValues = extractDeprecatedValues(rawMessage)}
										{@const deprecatedFlag = hasDeprecatedFlag(rawMessage)}
										{@const locationInfo = extractLocationInfo(rawMessage)}
										{@const detailHref = crdDetailHref(error)}
										<li>
											<button
												type="button"
												class={`flex w-full items-start gap-2 rounded-md p-2 text-left text-xs transition-colors hover:ring-2 hover:ring-blue-500/30 ${tone.row}`}
												on:click={() => scrollToErrorLine(error)}
												aria-label="Go to line for: {cleanMessage || rawMessage}"
											>
												{#if tone.iconType === 'warning'}
													<svg class={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${tone.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
													</svg>
												{:else}
													<svg class={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${tone.icon}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
														<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
													</svg>
												{/if}
												<div class="min-w-0 flex-1">
													<p class={`font-medium ${tone.text}`}>
														{cleanMessage || rawMessage}
													</p>
													{#if locationInfo}
														<p class="mt-1 font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-400">
															{locationInfo}
														</p>
													{/if}
													{#if allowedValues}
														<p class="mt-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
															Allowed values: {allowedValues}
														</p>
													{/if}
													{#if deprecatedValues}
														<p class="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
															Deprecated versions: {deprecatedValues}
														</p>
													{:else if deprecatedFlag}
														<p class="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
															Deprecated
														</p>
													{/if}
													{#if error.instancePath}
														<p class={`mt-0.5 font-mono text-[10px] ${tone.path}`}>
															Path: {error.instancePath}
														</p>
													{/if}
													{#if detailHref && isKindOrApiError(error)}
														<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
														<a
															href={detailHref}
															class="mt-1 inline-block text-[11px] font-semibold text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
															on:click|stopPropagation
														>
															View CRD schema →
														</a>
													{/if}
												</div>
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{:else}
						<div class="spec-search-empty">
							<div class="spec-search-empty-icon" aria-hidden="true">
								<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<p class="text-sm text-slate-600 dark:text-slate-400">
								{#if !release}
									Select a release and paste YAML to validate
								{:else if !yamlInput}
									Paste your YAML CRD configuration to validate
								{:else}
									Click "Validate YAML" or press Ctrl+Enter to check your configuration
								{/if}
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="mt-4">
			<PageCredits />
		</div>
	</div>
</div>
