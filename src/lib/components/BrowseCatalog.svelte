<script lang="ts">
	import Theme from '$lib/components/Theme.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { getLatestVersion } from '$lib/versions';

	export let allResources: CrdResource[] = [];
	export let selectedRelease: EdaRelease;
	export let allReleases: EdaRelease[] = [];
	export let onReleaseChange: (release: EdaRelease) => void | Promise<void> = () => {};
	export let onResourceClick: (resourceName: string) => void | Promise<void> = () => {};
	export let onExitBrowse: () => void = () => {};

	let searchQuery = '';
	let typeFilter: 'all' | 'state' | 'config' = 'all';

	type SortKey = 'kind' | 'group' | 'version';
	let sortKey: SortKey = 'kind';
	let sortAsc = true;

	$: filteredResources = allResources.filter((res) => {
		const query = searchQuery.trim().toLowerCase();
		if (query) {
			const terms = query.split(/\s+/);
			const haystack = `${res.name} ${res.kind} ${res.group}`.toLowerCase();
			if (!terms.every((term) => haystack.includes(term))) return false;
		}
		if (typeFilter === 'state') return res.name.toLowerCase().includes('states');
		if (typeFilter === 'config') return !res.name.toLowerCase().includes('states');
		return true;
	});

	$: sortedResources = [...filteredResources].sort((a, b) => {
		let cmp = 0;
		if (sortKey === 'kind') {
			cmp = displayKind(a).localeCompare(displayKind(b));
		} else if (sortKey === 'group') {
			cmp = displayGroup(a).localeCompare(displayGroup(b));
		} else {
			cmp = getLatestVersion(a).localeCompare(getLatestVersion(b));
		}
		return sortAsc ? cmp : -cmp;
	});

	function displayKind(res: CrdResource) {
		return res.kind || res.name.split('.')[0];
	}

	function displayGroup(res: CrdResource) {
		return res.group || res.name.split('.').slice(1).join('.');
	}

	function isAllDeprecated(res: CrdResource) {
		return res.versions.length > 0 && res.versions.every((v) => v.deprecated);
	}

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortAsc = !sortAsc;
		} else {
			sortKey = key;
			sortAsc = true;
		}
	}

	function sortIndicator(key: SortKey) {
		if (sortKey !== key) return '';
		return sortAsc ? '↑' : '↓';
	}

	async function handleReleaseSelect(event: Event) {
		const select = event.target as HTMLSelectElement;
		const release = allReleases.find((r) => r.name === select.value);
		if (release) await onReleaseChange(release);
	}

</script>

<div class="flex min-h-full flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
	<!-- Top bar -->
	<header
		class="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
	>
		<div class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
			<div class="flex min-w-0 items-center gap-3">
				<a href="/" class="flex shrink-0 items-center gap-2 no-underline" on:click|preventDefault={onExitBrowse}>
					<img
						src="/images/eda.svg"
						alt="Nokia EDA"
						width="32"
						height="32"
						class="rounded"
						loading="eager"
					/>
					<div class="hidden leading-tight sm:block">
						<div class="text-sm font-semibold text-blue-600 dark:text-blue-400">Nokia EDA</div>
						<div class="text-xs text-slate-600 dark:text-slate-300">Resource Browser</div>
					</div>
				</a>
				<div class="hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-700"></div>
				<h1 class="truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-white">
					CRD Catalog
				</h1>
			</div>

			<div class="flex items-center gap-2 sm:gap-3">
				<div class="flex items-center gap-2">
					<span
						class="hidden rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 sm:inline dark:bg-blue-900/30 dark:text-blue-300"
					>
						{selectedRelease.label}
					</span>
					<select
						value={selectedRelease.name}
						on:change={handleReleaseSelect}
						aria-label="Select EDA release"
						class="max-w-[9rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:max-w-none sm:px-3 sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
					>
						{#each allReleases as release}
							<option value={release.name}>
								{release.label}{release.default ? ' (Default)' : ''}
							</option>
						{/each}
					</select>
				</div>
				<Theme />
				<button
					type="button"
					on:click={onExitBrowse}
					class="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:inline-flex dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				>
					← Home
				</button>
			</div>
		</div>
	</header>

	<!-- Toolbar -->
	<div
		class="sticky top-14 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm sm:top-16 dark:border-slate-700 dark:bg-slate-900/95"
	>
		<div class="mx-auto max-w-7xl space-y-3 px-4 py-3 sm:px-6">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
				<div class="relative min-w-0 flex-1">
					<svg
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
					<input
						type="search"
						bind:value={searchQuery}
						placeholder="Search by kind, name, or API group…"
						class="w-full rounded-lg border border-slate-200 bg-white py-2.5 pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
					/>
				</div>
				<div
					class="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500 sm:text-sm dark:text-slate-400"
				>
					<span class="tabular-nums">{filteredResources.length}</span>
					<span>resource{filteredResources.length !== 1 ? 's' : ''}</span>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Resource type filter">
				<span class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
					>Filter</span
				>
				{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
					<button
						type="button"
						on:click={() => (typeFilter = chip.id as typeof typeFilter)}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors
						       {typeFilter === chip.id
							? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300'
							: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500'}"
					>
						{chip.label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Main content -->
	<main class="mx-auto w-full max-w-7xl flex-1 px-4 py-4 pb-16 sm:px-6 sm:py-6">
		{#if sortedResources.length === 0}
			<div
				class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-800"
			>
				<p class="text-sm text-slate-500 dark:text-slate-400">No resources match your search or filter.</p>
				<button
					type="button"
					on:click={() => {
						searchQuery = '';
						typeFilter = 'all';
					}}
					class="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
				>
					Clear filters
				</button>
			</div>
		{:else}
			<!-- Desktop table -->
			<div
				class="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block dark:border-slate-700 dark:bg-slate-800"
			>
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
							<th class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
								<button
									type="button"
									on:click={() => toggleSort('kind')}
									class="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
								>
									Kind <span class="text-xs opacity-60">{sortIndicator('kind')}</span>
								</button>
							</th>
							<th class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
								<button
									type="button"
									on:click={() => toggleSort('group')}
									class="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
								>
									API Group <span class="text-xs opacity-60">{sortIndicator('group')}</span>
								</button>
							</th>
							<th class="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">
								<button
									type="button"
									on:click={() => toggleSort('version')}
									class="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
								>
									Latest Version <span class="text-xs opacity-60">{sortIndicator('version')}</span>
								</button>
							</th>
							<th class="w-10 px-4 py-3"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100 dark:divide-slate-700">
						{#each sortedResources as resDef (resDef.name)}
							{@const latest = getLatestVersion(resDef)}
							<tr
								class="group cursor-pointer transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-900/10"
								role="button"
								tabindex="0"
								on:click={() => onResourceClick(resDef.name)}
								on:keydown={(e) => e.key === 'Enter' && onResourceClick(resDef.name)}
							>
								<td class="px-4 py-3">
									<div class="flex items-center gap-2">
										<span class="font-semibold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
											{displayKind(resDef)}
										</span>
										{#if isAllDeprecated(resDef)}
											<span
												class="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
											>
												DEPRECATED
											</span>
										{/if}
									</div>
								</td>
								<td class="px-4 py-3">
									<span class="font-mono text-xs text-slate-600 dark:text-slate-400">
										{displayGroup(resDef)}
									</span>
								</td>
								<td class="px-4 py-3">
									{#if latest}
										<span
											class="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
										>
											{latest}
										</span>
										{#if resDef.versions.length > 1}
											<span class="ml-2 text-xs text-slate-400">
												+{resDef.versions.length - 1} more
											</span>
										{/if}
									{/if}
								</td>
								<td class="px-4 py-3 text-right">
									<svg
										class="inline h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 5l7 7-7 7"
										/>
									</svg>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Mobile list -->
			<div class="space-y-2 md:hidden">
				{#each sortedResources as resDef (resDef.name)}
					{@const latest = getLatestVersion(resDef)}
					<button
						type="button"
						on:click={() => onResourceClick(resDef.name)}
						class="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:active:bg-slate-700"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-semibold text-slate-900 dark:text-white">
										{displayKind(resDef)}
									</span>
									{#if isAllDeprecated(resDef)}
										<span
											class="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
										>
											DEPRECATED
										</span>
									{/if}
								</div>
								<p class="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
									{displayGroup(resDef)}
								</p>
							</div>
							{#if latest}
								<span
									class="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
								>
									{latest}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Mobile back link -->
		<div class="mt-6 text-center sm:hidden">
			<button
				type="button"
				on:click={onExitBrowse}
				class="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
			>
				← Back to home
			</button>
		</div>
	</main>
</div>
