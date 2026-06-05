<script lang="ts">
	import yaml from 'js-yaml';

	import AppHeader from '$lib/components/AppHeader.svelte';
	import PageCredits from '$lib/components/PageCredits.svelte';
	import Render from '$lib/components/Render.svelte';

	import type { OpenAPISchema, Schema, VersionSchema } from '$lib/structure';
	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';

	let files: FileList;

	expandAll.set(false);
	expandAllScope.set('local');
	ulExpanded.set([]);

	let kind = '';
	let group = '';
	let versions: VersionSchema = {};
	let spec: Schema;
	let status: Schema;
	let plaintextCrd = '';

	let validVersions: string[] = [];
	let versionOnFocus: string = '';

	function processYaml() {
		try {
			const crd = yaml.load(plaintextCrd) as any;
			group = crd.spec.group;
			kind = crd.spec.names.kind;

			crd.spec.versions.forEach((x: OpenAPISchema) => {
				versions[x.name] = {
					spec: x.schema.openAPIV3Schema.properties.spec,
					status: x.schema.openAPIV3Schema.properties.status,
					deprecated: 'deprecated' in x ? x.deprecated : false
				};
			});

			validVersions = Object.keys(versions);
			versionOnFocus = validVersions[0];
			spec = versions[versionOnFocus].spec;
			status = versions[versionOnFocus].status;
		} catch (err) {
			window.alert(`[Error] Failed reading YAML: ${err}`);
		}
	}

	async function handleUpload() {
		if (files) {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					plaintextCrd = e.target?.result as string;
					processYaml();
					window.alert(`[Success] File uploaded.`);
				} catch (err) {
					window.alert(`[Error] Upload failed: ${err}`);
				}
			};
			reader.readAsText(files[0]);
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

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const versionOnFocus = select.value;
		spec = versions[versionOnFocus].spec;
		status = versions[versionOnFocus].status;
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | Uploads</title>
	<meta
		name="description"
		content="Upload a local CRD YAML file and explore its spec and status schema in the Resource Browser."
	/>
</svelte:head>

<div class="spec-search-page page-shell min-h-full bg-gray-50 dark:text-gray-100">
	<AppHeader contextTitle="CRD Uploads" contextBadge="Upload" fixed={false} />

	<div class="spec-search-main">
		<section class="spec-search-hero" aria-labelledby="uploads-heading">
			<p class="homepage-hero-kicker">Local schema viewer</p>
			<h1 id="uploads-heading" class="homepage-title text-slate-900 dark:text-slate-100">
				Upload CRD YAML
			</h1>
			<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
				Paste or upload a CustomResourceDefinition file to browse its spec and status schemas
				without selecting a release.
			</p>
		</section>

		<nav
			class="flex flex-wrap items-center gap-2 text-sm"
			aria-label="Related tools"
		>
			<span class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
				>Also try</span
			>
			<a
				href="/validate-yaml"
				class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:text-blue-300 dark:hover:border-blue-500"
			>
				Validate YAML
			</a>
			<a
				href="/comparison"
				class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:text-blue-300 dark:hover:border-blue-500"
			>
				Compare releases
			</a>
			<a
				href="/?browse=true"
				class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-600 dark:bg-slate-800 dark:text-blue-300 dark:hover:border-blue-500"
			>
				Browse catalog
			</a>
		</nav>

		<div class="grid gap-4 md:grid-cols-2">
			<div>
				<label for="crdText" class="mb-2 block text-sm font-medium text-slate-900 dark:text-white"
					>CRD YAML</label
				>
				<textarea
					id="crdText"
					class="font-fira h-36 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
					placeholder="Paste your YAML content here..."
					bind:value={plaintextCrd}
					on:keyup={() => processYaml()}
				></textarea>
			</div>
			<div>
				<label for="dropzone" class="mb-2 block text-sm font-medium text-slate-900 dark:text-white"
					>File upload</label
				>
				<input
					id="dropzone"
					type="file"
					class="peer hidden"
					accept="application/yaml"
					bind:files
					on:change={handleUpload}
				/>
				<label
					for="dropzone"
					class="flex h-36 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-blue-500"
				>
					<div class="flex items-center space-x-2 pr-2">
						<svg
							class="h-4 w-4"
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							width="24"
							height="24"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 5v9m-5 0H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2M8 9l4-5 4 5m1 8h.01"
							/>
						</svg>
						<p class="text-sm">Click to upload a CRD</p>
					</div>
					<div class="border-l border-slate-300 pl-2 dark:border-slate-600">
						<p class="text-xs">Supported format: .yaml (max 10 MB)</p>
						<p class="text-xs text-amber-600 dark:text-amber-400">
							Reloading the page clears uploaded data
						</p>
					</div>
				</label>
			</div>
		</div>

		{#if kind !== ''}
			<div class="flex flex-col gap-2 pt-2">
				<p class="font-nokia-headline text-lg text-slate-900 dark:text-slate-100">{kind}</p>
				<div class="font-fira flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
					<span>{group}</span>
					<span class="mx-0.5">/</span>
					{#if validVersions.length > 1}
						<select
							class="select-pro rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
							bind:value={versionOnFocus}
							on:change={handleVersionChange}
						>
							{#each validVersions as version}
								<option value={version}>{version}</option>
							{/each}
						</select>
					{:else}
						<span>{validVersions[0]}</span>
					{/if}
					{#if versions[versionOnFocus].deprecated}
						<span
							class="ml-2 rounded-lg bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
							>deprecated</span
						>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-2 pt-1">
				<button
					type="button"
					class="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
          {$ulExpanded.length > 0
						? 'border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600'
						: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600'}"
					on:click={handleGlobalExpand}
				>
					{$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} all
				</button>
			</div>
			<div
				class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
			>
				<Render source={'uploaded'} type={'spec'} data={spec} showType={false} />
			</div>
			<div
				class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
			>
				<Render source={'uploaded'} type={'status'} data={status} showType={false} />
			</div>
		{:else}
			<div class="spec-search-empty">
				<div class="spec-search-empty-icon">
					<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
						/>
					</svg>
				</div>
				<h3 class="text-lg font-semibold text-slate-900 dark:text-white">Upload or paste a CRD</h3>
				<p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
					Provide a CustomResourceDefinition YAML file to inspect its OpenAPI schema locally.
				</p>
			</div>
		{/if}

		<div class="mt-6">
			<PageCredits />
		</div>
	</div>
</div>
