<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ResourceModal from '$lib/components/ResourceModal.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { getLatestVersion } from '$lib/versions';

	export let allResources: CrdResource[] = [];
	export let selectedRelease: EdaRelease;
	export let allReleases: EdaRelease[] = [];
	export let onReleaseChange: (release: EdaRelease) => void | Promise<void> = () => {};
	export let onExitBrowse: () => void = () => {};
	/** Open ResourceModal for this CRD name when catalog loads (from URL ?resource=) */
	export let initialResourceName: string | null = null;
	export let onResourceModalClose: (() => void) | undefined = undefined;

	let searchQuery = '';
	let typeFilter: 'all' | 'state' | 'config' = 'all';

	type SortKey = 'kind' | 'group' | 'version';
	let sortKey: SortKey = 'kind';
	let sortAsc = true;

	let modalOpen = false;
	let modalResource: CrdResource | null = null;
	let openedInitialResource: string | null = null;

	// Keep modal resource in sync when release/manifest reloads
	$: if (modalOpen && modalResource) {
		const updated = allResources.find((r) => r.name === modalResource?.name);
		if (updated && updated !== modalResource) {
			modalResource = updated;
		}
	}

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

	function openResourceModal(res: CrdResource, event?: Event) {
		event?.preventDefault();
		modalResource = res;
		modalOpen = true;
	}

	function closeResourceModal() {
		modalOpen = false;
		modalResource = null;
		onResourceModalClose?.();
	}

	$: if (
		initialResourceName &&
		initialResourceName !== openedInitialResource &&
		allResources.length > 0
	) {
		const res = allResources.find((r) => r.name === initialResourceName);
		openedInitialResource = initialResourceName;
		if (res) {
			modalResource = res;
			modalOpen = true;
		}
	}

	$: if (!initialResourceName) {
		openedInitialResource = null;
	}
</script>

<div
	class="page-shell flex min-h-full min-w-0 flex-col overflow-x-hidden bg-gray-50 text-sm text-gray-900 dark:text-gray-100"
>
	<AppHeader
		onLogoClick={(e) => {
			e.preventDefault();
			onExitBrowse();
		}}
	>
		<svelte:fragment slot="actions">
			<span
				class="hidden max-w-[7rem] truncate rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 md:inline dark:bg-blue-900/30 dark:text-blue-300"
			>
				{selectedRelease.label}
			</span>
			<select
				value={selectedRelease.name}
				on:change={handleReleaseSelect}
				aria-label="Select EDA release"
				class="max-w-[7.5rem] min-h-11 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:max-w-none sm:px-3 sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
			>
				{#each allReleases as release}
					<option value={release.name}>
						{release.label}{release.default ? ' (Latest)' : ''}
					</option>
				{/each}
			</select>
		</svelte:fragment>
	</AppHeader>

	<!-- Toolbar -->
	<div
		class="sticky top-14 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm sm:top-16 dark:border-slate-700 dark:bg-slate-900/95"
	>
		<div class="mx-auto max-w-7xl min-w-0 space-y-2.5 px-3 py-2.5 sm:space-y-3 sm:px-6 sm:py-3">
			<div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
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
						placeholder="Search kind, name, or group…"
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
					/>
				</div>
				<div
					class="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 sm:text-sm dark:text-slate-400"
				>
					<span class="tabular-nums">{filteredResources.length}</span>
					<span>resource{filteredResources.length !== 1 ? 's' : ''}</span>
				</div>
			</div>

			<div
				class="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-0.5"
				role="group"
				aria-label="Resource type filter"
			>
				<span class="shrink-0 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
					>Filter</span
				>
				{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
					<button
						type="button"
						on:click={() => (typeFilter = chip.id as typeof typeFilter)}
						class="shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-colors
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
	<main
		class="mx-auto w-full min-w-0 max-w-7xl flex-1 overflow-x-hidden px-3 py-3 pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6"
	>
		{#if sortedResources.length === 0}
			<div
				class="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center sm:px-6 sm:py-12 dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
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
				class="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
			>
				<div class="overflow-x-auto">
					<table class="w-full min-w-0 text-left text-sm">
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
									on:click={(e) => openResourceModal(resDef, e)}
									on:keydown={(e) => e.key === 'Enter' && openResourceModal(resDef)}
								>
									<td class="px-4 py-3">
										<div class="flex items-center gap-2">
											<span
												class="font-semibold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400"
											>
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
									<td class="max-w-[12rem] px-4 py-3">
										<span class="block truncate font-mono text-xs text-slate-600 dark:text-slate-400">
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
			</div>

			<!-- Mobile cards -->
			<div class="space-y-2 md:hidden">
				{#each sortedResources as resDef (resDef.name)}
					{@const latest = getLatestVersion(resDef)}
					<button
						type="button"
						on:click={(e) => openResourceModal(resDef, e)}
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-colors active:border-blue-300 active:bg-blue-50/40 dark:border-blue-900/40 dark:bg-[#0f2a48]/88 dark:active:border-blue-500 dark:active:bg-[#123a5c]/90"
					>
						<div class="flex min-w-0 items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-1.5">
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
								<p class="mt-0.5 break-all font-mono text-xs leading-snug text-slate-500 dark:text-slate-400">
									{displayGroup(resDef)}
								</p>
								{#if resDef.versions.length > 1}
									<p class="mt-0.5 text-xs text-slate-400">{resDef.versions.length} versions</p>
								{/if}
							</div>
							<div class="flex shrink-0 flex-col items-end gap-1">
								{#if latest}
									<span
										class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
									>
										{latest}
									</span>
								{/if}
								<svg
									class="h-4 w-4 text-slate-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
								</svg>
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</main>
</div>

<ResourceModal
	open={modalOpen}
	resourceDef={modalResource}
	{selectedRelease}
	{allReleases}
	onClose={closeResourceModal}
/>
