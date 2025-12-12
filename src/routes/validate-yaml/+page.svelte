<script lang="ts">
	import yaml from 'js-yaml';
	import { onMount } from 'svelte';
	import TopHeader from '$lib/components/TopHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import releasesYaml from '$lib/releases.yaml?raw';
	import type { EdaRelease, ReleasesConfig } from '$lib/structure';
	import type { ErrorObject } from 'ajv';

	const releasesConfig = yaml.load(releasesYaml) as ReleasesConfig;

	let releaseName = '';
	let release: EdaRelease | null = null;
	let yamlInput = '';
	let validationErrors: ErrorObject[] = [];
	let validationResult: 'valid' | 'invalid' | null = null;
	let isValidating = false;

	$: release = releaseName
		? releasesConfig.releases.find((r) => r.name === releaseName) || null
		: null;

	// Simple in-memory cache for manifests
	const manifestCache: Map<string, any> = new Map();

	async function validateYaml() {
		const [{ default: Ajv }] = await Promise.all([import('ajv')]);
		const yamlLib = (await import('js-yaml')).default;

		if (!yamlInput.trim()) {
			validationErrors = [];
			validationResult = null;
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
				} as ErrorObject
			];
			validationResult = 'invalid';
			return;
		}

		isValidating = true;
		validationErrors = [];
		validationResult = null;

		try {
			// Load manifest for the release
			let manifest: any;
			if (manifestCache.has(release.folder)) {
				manifest = manifestCache.get(release.folder);
			} else {
				const resp = await fetch(`/${release.folder}/manifest.json`);
				if (!resp.ok) {
					validationErrors = [
						{
							message: 'Failed to load release manifest',
							instancePath: '',
							schemaPath: '',
							keyword: 'manifest',
							params: {}
						} as ErrorObject
					];
					validationResult = 'invalid';
					isValidating = false;
					return;
				}
				manifest = await resp.json();
				manifestCache.set(release.folder, manifest);
			}

			// Parse YAML documents (separated by ---)
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
					parsedDocs.push(...allDocs.filter((d: any) => d !== null && d !== undefined));
				}
			}

			if (parsedDocs.length === 0) {
				const allDocs = yamlLib.loadAll(yamlInput);
				parsedDocs.push(...allDocs.filter((d: any) => d !== null && d !== undefined));
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

			const ajv = new Ajv({
				allErrors: true,
				verbose: true,
				strict: false,
				validateFormats: false,
				coerceTypes: false
			});

			let valid = true;
			const errors: ErrorObject[] = [];
			const warnings: string[] = [];

			// Validate each document
			for (let index = 0; index < parsedDocs.length; index++) {
				const parsedYaml = parsedDocs[index];
				const docPrefix = parsedDocs.length > 1 ? `[Doc ${index + 1}] ` : '';

				// 1. Check apiVersion
				if (!parsedYaml.apiVersion) {
					errors.push({
						message: `${docPrefix}Missing required 'apiVersion' field`,
						instancePath: '/apiVersion',
						schemaPath: '#/required',
						keyword: 'required',
						params: { missingProperty: 'apiVersion' }
					} as ErrorObject);
					valid = false;
					continue; // Can't validate further without apiVersion
				}

				// Parse apiVersion to get group and version
				const apiVersionParts = parsedYaml.apiVersion.split('/');
				if (apiVersionParts.length !== 2) {
					errors.push({
						message: `${docPrefix}Invalid apiVersion format: '${parsedYaml.apiVersion}' (expected 'group/version')`,
						instancePath: '/apiVersion',
						schemaPath: '#/properties/apiVersion/pattern',
						keyword: 'pattern',
						params: {}
					} as ErrorObject);
					valid = false;
					continue;
				}

				const group = apiVersionParts[0];
				const version = apiVersionParts[1];

				// 2. Check kind
				if (!parsedYaml.kind) {
					errors.push({
						message: `${docPrefix}Missing required 'kind' field`,
						instancePath: '/kind',
						schemaPath: '#/required',
						keyword: 'required',
						params: { missingProperty: 'kind' }
					} as ErrorObject);
					valid = false;
					continue;
				}

				// 3. Check metadata
				if (!parsedYaml.metadata) {
					errors.push({
						message: `${docPrefix}Missing required 'metadata' field`,
						instancePath: '/metadata',
						schemaPath: '#/required',
						keyword: 'required',
						params: { missingProperty: 'metadata' }
					} as ErrorObject);
					valid = false;
				} else {
					if (!parsedYaml.metadata.name) {
						errors.push({
							message: `${docPrefix}Missing required 'metadata.name' field`,
							instancePath: '/metadata/name',
							schemaPath: '#/properties/metadata/required',
							keyword: 'required',
							params: { missingProperty: 'name' }
						} as ErrorObject);
						valid = false;
					}
					// Validate metadata.name format (DNS subdomain)
					if (
						parsedYaml.metadata.name &&
						!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(
							parsedYaml.metadata.name
						)
					) {
						errors.push({
							message: `${docPrefix}metadata.name must be a valid DNS subdomain (lowercase alphanumeric, hyphens, dots)`,
							instancePath: '/metadata/name',
							schemaPath: '#/properties/metadata/properties/name/pattern',
							keyword: 'pattern',
							params: { pattern: 'DNS subdomain' }
						} as ErrorObject);
						valid = false;
					}
			}

			// Find the resource in manifest by kind
			// First try exact kind match, then fallback to name matching
			let resourceEntry = manifest.find((r: any) => r.kind === parsedYaml.kind);
			
			if (!resourceEntry) {
				// Fallback: try to find by checking if kind appears in the resource name
				resourceEntry = manifest.find((r: any) => {
					const kindLower = parsedYaml.kind?.toLowerCase();
					const nameLower = r.name?.toLowerCase();
					// Extract the resource type from the full name (before the first dot)
					const resourceType = nameLower?.split('.')[0];
					return resourceType === kindLower;
				});
			}

			if (!resourceEntry) {
				errors.push({
					message: `${docPrefix}Could not find CRD definition for kind '${parsedYaml.kind}' in release ${release.label}. Available kinds: ${manifest.map((r: any) => r.kind).filter(Boolean).slice(0, 5).join(', ')}...`,
					instancePath: '/kind',
					schemaPath: '#/properties/kind',
					keyword: 'enum',
					params: {}
				} as ErrorObject);
				valid = false;
				continue;
			}				// Load the CRD schema for the specific version
				try {
					const path = `/${release.folder}/${resourceEntry.name}/${version}.yaml`;
					const schemaResp = await fetch(path);
					if (!schemaResp.ok) {
						warnings.push(
							`${docPrefix}Could not find schema for ${parsedYaml.kind} version ${version}`
						);
						continue;
					}

				const schemaText = await schemaResp.text();
				const schemaParsed = yaml.load(schemaText) as any;
				const spec = schemaParsed?.schema?.openAPIV3Schema?.properties?.spec;
				const status = schemaParsed?.schema?.openAPIV3Schema?.properties?.status;

				// 4. Validate spec field against schema
				if (parsedYaml.spec && spec) {
					// Validate spec directly (including null checks if schema requires values)
					const specValidator = ajv.compile(spec);
					if (!specValidator(parsedYaml.spec)) {
						valid = false;
						const docErrors = (specValidator.errors || []).map((err: any) => {
							// Enhanced error message for missing required properties
							let message = err.message || 'validation error';
							if (err.keyword === 'required' && spec.required) {
								message = `${message}. Required fields in spec: ${spec.required.join(', ')}`;
							}
							return {
								...err,
								message: `${docPrefix}spec${err.instancePath}: ${message}`,
								instancePath: `/spec${err.instancePath}`
							};
						});
						errors.push(...docErrors);
					}
				} else if (!parsedYaml.spec) {
					// Check if spec is required
					const topLevelSchema = schemaParsed?.schema?.openAPIV3Schema;
					const isSpecRequired = topLevelSchema?.required?.includes('spec');
					if (isSpecRequired || spec) {
						errors.push({
							message: `${docPrefix}Missing required 'spec' field`,
							instancePath: '/spec',
							schemaPath: '#/required',
							keyword: 'required',
							params: { missingProperty: 'spec' }
						} as ErrorObject);
						valid = false;
					}
				}					// 5. Validate status field if present (optional for create, but validate structure if provided)
					if (parsedYaml.status && status) {
						const statusValidator = ajv.compile(status);
						if (!statusValidator(parsedYaml.status)) {
							// Status validation failures are warnings, not errors
							const statusErrors = (statusValidator.errors || []).map(
								(err: any) => `${docPrefix}status${err.instancePath}: ${err.message}`
							);
							warnings.push(...statusErrors);
						}
					}

					// 6. Check for unexpected top-level fields
					const allowedTopLevel = ['apiVersion', 'kind', 'metadata', 'spec', 'status'];
					const unexpectedFields = Object.keys(parsedYaml).filter(
						(k) => !allowedTopLevel.includes(k)
					);
					if (unexpectedFields.length > 0) {
						warnings.push(`${docPrefix}Unexpected top-level fields: ${unexpectedFields.join(', ')}`);
					}
				} catch (e) {
					warnings.push(
						`${docPrefix}Error loading schema for ${parsedYaml.kind}: ${e instanceof Error ? e.message : String(e)}`
					);
				}
			}

			if (valid) {
				validationResult = 'valid';
				const successMsg =
					parsedDocs.length > 1
						? `✓ Successfully validated ${parsedDocs.length} Nokia EDA CRD documents`
						: '✓ Valid Nokia EDA CRD configuration';
				validationErrors = [
					{
						message: successMsg,
						instancePath: '',
						schemaPath: '',
						keyword: 'success',
						params: { warnings: warnings.length }
					} as ErrorObject
				];
				// Add warnings if any
				if (warnings.length > 0) {
					warnings.forEach((w) => {
						validationErrors.push({
							message: `⚠ ${w}`,
							instancePath: '',
							schemaPath: '',
							keyword: 'warning',
							params: {}
						} as ErrorObject);
					});
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
</script>

<svelte:head>
	<title>EDA Resource Browser | YAML Validation</title>
</svelte:head>

<TopHeader title="YAML Validation" />

<div class="relative flex h-full flex-col overflow-y-auto pt-12 md:pt-14">
	<div class="mx-auto w-full max-w-7xl flex-1 px-4 py-4 md:py-6">
		<!-- Release Selection -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<select
				id="validation-release"
				bind:value={releaseName}
				class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm transition-all hover:border-purple-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:border-gray-500 dark:focus:border-purple-400"
			>
				<option value="">Select release...</option>
				{#each releasesConfig.releases as r}
					<option value={r.name}>{r.label}</option>
				{/each}
			</select>

			{#if release}
				<div
					class="ml-auto flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm dark:border-purple-800 dark:bg-purple-900/20"
				>
					<svg class="h-4 w-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span class="font-medium text-purple-700 dark:text-purple-300">{release.label}</span>
				</div>
			{/if}
		</div>

		<!-- Main Content -->
		<div class="grid gap-4 md:gap-6 lg:grid-cols-2">
			<!-- Input Section -->
			<div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-indigo-50 px-4 py-3 md:px-5 md:py-4 dark:border-gray-700 dark:from-purple-900/20 dark:to-indigo-900/20">
					<div class="flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 shadow-md">
							<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
						</div>
						<div>
							<h2 class="text-base font-bold text-gray-900 md:text-lg dark:text-white">YAML Input</h2>
							<p class="text-xs text-gray-600 dark:text-gray-400">Paste your CRD configurations (separate multiple with ---)</p>
						</div>
					</div>
				</div>

				<div class="p-4 md:p-5">
					<div class="space-y-3">
						<!-- Instructions -->
						<div class="rounded-lg border border-purple-200 bg-purple-50/50 p-3 dark:border-purple-800 dark:bg-purple-900/10">
							<h3 class="mb-2 text-sm font-semibold text-purple-900 dark:text-purple-100">Nokia EDA CRD Validation</h3>
							<ul class="space-y-1 text-xs text-purple-800 dark:text-purple-200">
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span><strong>apiVersion</strong> must match selected release version</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span><strong>kind</strong> must exist in the selected release</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span><strong>metadata.name</strong> must be valid DNS subdomain</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span><strong>spec</strong> validated against CRD schema (including required fields)</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span><strong>status</strong> optional, generates warnings if invalid</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
									</svg>
									<span class="text-amber-800 dark:text-amber-200">Each CRD may have different <strong>required fields</strong> in spec</span>
								</li>
							</ul>
						</div>

						<!-- YAML Textarea -->
						<div>
							<textarea
								bind:value={yamlInput}
								placeholder="apiVersion: protocols.eda.nokia.com/v1alpha1
kind: BgpPeer
metadata:
  name: my-bgp-peer
spec:
  peerAddress: 192.168.1.1
  peerAs: 65001
---
apiVersion: services.eda.nokia.com/v1alpha1
kind: BridgeDomain
metadata:
  name: my-bridge
spec:
  vlanId: 100"
								class="min-h-[400px] w-full rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 hover:border-purple-400 focus:border-purple-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-500 dark:focus:border-purple-400 dark:focus:bg-gray-800"
							></textarea>
						</div>

						<!-- Action Buttons -->
						<div class="flex flex-wrap gap-2">
							<button
								on:click={validateYaml}
								disabled={isValidating || !release}
								class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:from-purple-700 hover:to-indigo-700 hover:shadow-lg disabled:cursor-not-allowed disabled:from-gray-400 disabled:to-gray-500"
							>
								{#if isValidating}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
									<span>Validating...</span>
								{:else}
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<span>Validate YAML</span>
								{/if}
							</button>

							{#if yamlInput}
								<button
									on:click={() => {
										yamlInput = '';
										validationErrors = [];
										validationResult = null;
									}}
									class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
									<span>Clear</span>
								</button>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Results Section -->
			<div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
				<div class="border-b border-gray-200 bg-gradient-to-r from-cyan-50 to-blue-50 px-4 py-3 md:px-5 md:py-4 dark:border-gray-700 dark:from-cyan-900/20 dark:to-blue-900/20">
					<div class="flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md">
							<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
							</svg>
						</div>
						<div>
							<h2 class="text-base font-bold text-gray-900 md:text-lg dark:text-white">Validation Results</h2>
							<p class="text-xs text-gray-600 dark:text-gray-400">Errors, warnings, and validation status</p>
						</div>
					</div>
				</div>

				<div class="p-4 md:p-5">
					{#if validationErrors.length > 0}
						{#if validationResult === 'valid'}
							<div class="space-y-3 rounded-lg border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-3 md:p-4 dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20">
								<div class="flex items-start gap-2 md:gap-3">
									<svg class="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 md:h-6 md:w-6 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
														<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
														</svg>
														<p class="text-xs text-yellow-800 dark:text-yellow-200">
															{error.message}
														</p>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							</div>
						{:else}
							<div class="rounded-lg border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-3 md:p-4 dark:border-red-800 dark:from-red-900/20 dark:to-rose-900/20">
								<div class="flex items-start gap-2 md:gap-3">
									<svg class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 md:h-6 md:w-6 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<div class="min-w-0 flex-1">
										<h4 class="mb-2 text-sm font-semibold text-red-900 md:text-base dark:text-red-100">
											Validation Failed ({validationErrors.length} error{validationErrors.length > 1 ? 's' : ''})
										</h4>
										<ul class="space-y-2">
											{#each validationErrors as error}
												<li class="flex items-start gap-2 rounded-md bg-white/50 p-2 text-xs dark:bg-black/20">
													<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
														<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
													</svg>
													<div class="flex-1">
														<p class="font-medium text-red-900 dark:text-red-100">
															{error.message}
														</p>
														{#if (error as any).instancePath || (error as any).dataPath}
															<p class="mt-0.5 font-mono text-[10px] text-red-700 dark:text-red-300">
																Path: {(error as any).instancePath || (error as any).dataPath}
															</p>
														{/if}
													</div>
												</li>
											{/each}
										</ul>
									</div>
								</div>
							</div>
						{/if}
					{:else}
						<div class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-12 text-center dark:border-gray-700 dark:bg-gray-900">
							<svg class="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
							<p class="mt-3 text-sm text-gray-600 dark:text-gray-400">
								{#if !release}
									Select a release and paste YAML to validate
								{:else if !yamlInput}
									Paste your YAML CRD configuration to validate
								{:else}
									Click "Validate YAML" to check your configuration
								{/if}
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Footer Credits -->
		<div class="mt-8">
			<PageCredits />
		</div>
	</div>
</div>
