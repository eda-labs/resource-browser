<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import Theme from '$lib/components/Theme.svelte';
	import type { CrdResource, EdaRelease } from '$lib/structure';
	import { getLatestVersion } from '$lib/versions';
	import type { Writable } from 'svelte/store';

	type ReleaseGroup = {
		label: string;
		releases: EdaRelease[];
		showMore: boolean;
	};

	export let groupedReleases: ReleaseGroup[];
	export let selectedRelease: Writable<EdaRelease>;
	export let crdMetaStore: Writable<CrdResource[]>;
	export let totalReleases: number;
	export let onReleaseSelect: (release: EdaRelease) => void | Promise<void>;
	export let onResourceSelect: (resourceName: string) => void | Promise<void>;

	let heroSearch = '';
	let searchFocused = false;
	let highlightedIndex = 0;
	let resourceTypeFilter: 'all' | 'state' | 'config' = 'all';
	let animatedResourceCount = 0;
	let animatedReleaseCount = 0;
	let prevResourceCount = -1;

	const tools = [
		{
			href: '/comparison',
			title: 'Release Comparison',
			description: 'Diff CRD schemas across EDA releases and export change reports.',
			gradient: 'from-violet-500 to-purple-600',
			shadow: 'hover:shadow-purple-500/20',
			border: 'hover:border-purple-400/40',
			icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
		},
		{
			href: '/spec-search',
			title: 'Spec Search',
			description: 'Search thousands of CRD paths, fields, and nested properties instantly.',
			gradient: 'from-cyan-500 to-blue-600',
			shadow: 'hover:shadow-cyan-500/20',
			border: 'hover:border-cyan-400/40',
			icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
		},
		{
			href: '/validate-yaml',
			title: 'YAML Validation',
			description: 'Validate manifests against official Nokia EDA OpenAPI schemas.',
			gradient: 'from-emerald-500 to-teal-600',
			shadow: 'hover:shadow-emerald-500/20',
			border: 'hover:border-emerald-400/40',
			icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
		}
	];

	$: filteredResources = $crdMetaStore
		.filter((resource) => {
			const query = heroSearch.trim().toLowerCase();
			if (!query) return false;
			const terms = query.split(/\s+/);
			const haystack = `${resource.name} ${resource.kind} ${resource.group}`.toLowerCase();
			if (!terms.every((term) => haystack.includes(term))) return false;
			if (resourceTypeFilter === 'state') return resource.name.toLowerCase().includes('states');
			if (resourceTypeFilter === 'config') return !resource.name.toLowerCase().includes('states');
			return true;
		})
		.slice(0, 8);

	$: multiVersionCount = $crdMetaStore.filter((r) => r.versions.length > 1).length;
	$: showSearchResults = searchFocused && heroSearch.trim().length > 0;

	$: if (filteredResources.length === 0) {
		highlightedIndex = 0;
	} else if (highlightedIndex >= filteredResources.length) {
		highlightedIndex = filteredResources.length - 1;
	}

	function animateCount(target: number, setter: (n: number) => void, duration = 900) {
		const start = performance.now();
		const tick = (now: number) => {
			const progress = Math.min((now - start) / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			setter(Math.round(target * eased));
			if (progress < 1) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	$: {
		const count = $crdMetaStore.length;
		if (count !== prevResourceCount) {
			prevResourceCount = count;
			animateCount(count, (n) => (animatedResourceCount = n));
		}
	}
	$: animateCount(totalReleases, (n) => (animatedReleaseCount = n));

	function shortName(name: string) {
		return name.split('.')[0];
	}

	function groupName(name: string) {
		return name.split('.').slice(1).join('.');
	}

	function isDeprecated(resource: CrdResource) {
		return resource.versions.length > 0 && resource.versions.every((v) => v.deprecated);
	}

	async function pickResource(resource: CrdResource) {
		heroSearch = '';
		searchFocused = false;
		await onResourceSelect(resource.name);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (!showSearchResults || filteredResources.length === 0) {
			if (event.key === 'Enter' && filteredResources[0]) {
				event.preventDefault();
				void pickResource(filteredResources[0]);
			}
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			highlightedIndex = (highlightedIndex + 1) % filteredResources.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			highlightedIndex =
				(highlightedIndex - 1 + filteredResources.length) % filteredResources.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			void pickResource(filteredResources[highlightedIndex]);
		} else if (event.key === 'Escape') {
			searchFocused = false;
			heroSearch = '';
		}
	}

	function toggleGroupShow(label: string) {
		groupedReleases = groupedReleases.map((g) =>
			g.label === label ? { ...g, showMore: !g.showMore } : g
		);
	}

	async function handleReleaseClick(release: EdaRelease) {
		await onReleaseSelect(release);
		goto(`/?release=${release.name}`, { replaceState: true, keepFocus: true });
	}

	function browseResources() {
		const first = $crdMetaStore[0];
		if (!first) return;
		const version = getLatestVersion(first);
		if (version) {
			goto(`/${first.name}/${version}?release=${$selectedRelease.name}`);
		}
	}
</script>

<div class="homepage-welcome relative min-h-full overflow-y-auto pb-10">
	<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
		<div
			class="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-500/20 blur-3xl"
		></div>
		<div class="absolute top-1/3 right-0 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl"></div>
		<div class="homepage-grid absolute inset-0 opacity-40"></div>
	</div>

	<div class="absolute top-4 right-4 z-50">
		<Theme />
	</div>

	<div class="relative mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
		<!-- Hero -->
		<section class="mb-10 text-center lg:mb-14" in:fade={{ duration: 400 }}>
			<div
				class="homepage-badge mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-cyan-100 backdrop-blur-md dark:text-cyan-200"
			>
				<span class="relative flex h-2 w-2">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
					></span>
					<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
				</span>
				{$selectedRelease.label}{#if $selectedRelease.default} · Default release{/if}
			</div>

			<div class="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
				<img
					src="/images/eda.svg"
					alt="Nokia EDA"
					class="h-16 w-16 drop-shadow-2xl sm:h-20 sm:w-20"
					loading="eager"
					fetchpriority="high"
				/>
				<div class="text-left sm:text-center">
					<h1
						class="font-nokia-headline text-4xl font-extrabold tracking-tight text-blue-400 sm:text-5xl lg:text-6xl"
					>
						Nokia EDA
					</h1>
					<p class="mt-1 text-lg font-light text-amber-500 sm:text-xl dark:text-amber-300">
						Resource Browser
					</p>
				</div>
			</div>

			<p
				class="homepage-hero-copy mx-auto max-w-3xl text-base leading-relaxed text-slate-700 sm:text-lg dark:text-slate-200"
			>
				Explore, compare, and validate Nokia EDA Custom Resource Definitions across every release —
				with live schema search and instant YAML validation built in.
			</p>

			<!-- Stats -->
			<div
				class="mx-auto mt-8 grid max-w-3xl grid-cols-3 gap-3 sm:gap-4"
				in:fly={{ y: 16, duration: 450, delay: 120 }}
			>
				{#each [{ value: animatedReleaseCount, label: 'Releases' }, { value: animatedResourceCount, label: 'CRDs' }, { value: multiVersionCount, label: 'Multi-version' }] as stat}
					<div class="homepage-stat-card rounded-2xl px-3 py-4 sm:px-5">
						<div class="text-2xl font-bold text-blue-400 sm:text-3xl">{stat.value}</div>
						<div class="mt-1 text-xs font-medium text-slate-600 sm:text-sm dark:text-slate-300">
							{stat.label}
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- Search + Release picker -->
		<section
			class="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8"
			in:fly={{ y: 20, duration: 500, delay: 180 }}
		>
			<!-- Command-palette search -->
			<div class="lg:col-span-7">
				<div class="homepage-panel rounded-2xl p-5 sm:p-6">
					<div class="mb-4 flex items-center justify-between gap-3">
						<h2 class="text-lg font-bold text-slate-900 dark:text-white">Find a resource</h2>
						<button
							on:click={browseResources}
							class="text-xs font-semibold text-cyan-600 transition-colors hover:text-cyan-500 dark:text-cyan-300"
						>
							Browse all →
						</button>
					</div>

					<div class="relative">
						<div class="homepage-search-ring rounded-xl transition-shadow duration-300">
							<div class="flex items-center gap-3 rounded-xl border border-white/20 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-900/70">
								<svg
									class="h-5 w-5 shrink-0 text-slate-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
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
									bind:value={heroSearch}
									on:focus={() => (searchFocused = true)}
									on:blur={() => setTimeout(() => (searchFocused = false), 150)}
									on:keydown={handleSearchKeydown}
									placeholder="Search by name, kind, or API group…"
									class="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white dark:placeholder:text-slate-500"
									autocomplete="off"
									aria-label="Search CRD resources"
									aria-expanded={showSearchResults}
									aria-controls="homepage-search-results"
								/>
								<kbd
									class="hidden rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 sm:inline dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
									>↵</kbd
								>
							</div>
						</div>

						{#if showSearchResults}
							<ul
								id="homepage-search-results"
								role="listbox"
								class="homepage-results absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/20 bg-white/95 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
								transition:fly={{ y: -6, duration: 180 }}
							>
								{#if filteredResources.length === 0}
									<li class="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
										No resources match “{heroSearch}”
									</li>
								{:else}
									{#each filteredResources as resource, i}
										<li role="option" aria-selected={i === highlightedIndex}>
											<button
												on:mousedown|preventDefault={() => pickResource(resource)}
												class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
												       {i === highlightedIndex
													? 'bg-cyan-500/15 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-100'
													: 'hover:bg-slate-100 dark:hover:bg-slate-800'}"
											>
												<div class="min-w-0">
													<div class="flex items-center gap-2">
														<span class="truncate text-sm font-semibold text-slate-900 dark:text-white">
															{resource.kind || shortName(resource.name)}
														</span>
														{#if isDeprecated(resource)}
															<span
																class="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300"
																>DEPRECATED</span
															>
														{/if}
													</div>
													<div class="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
														{groupName(resource.name)}
													</div>
												</div>
												<div class="flex shrink-0 items-center gap-2">
													{#if resource.versions.length > 1}
														<span
															class="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
														>
															{getLatestVersion(resource)}
														</span>
													{/if}
													<svg
														class="h-4 w-4 text-slate-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M9 5l7 7-7 7"
														/>
													</svg>
												</div>
											</button>
										</li>
									{/each}
								{/if}
							</ul>
						{/if}
					</div>

					<div class="mt-4 flex flex-wrap gap-2">
						{#each [{ id: 'all', label: 'All' }, { id: 'config', label: 'Config' }, { id: 'state', label: 'State' }] as chip}
							<button
								on:click={() => (resourceTypeFilter = chip.id as typeof resourceTypeFilter)}
								class="rounded-full px-3 py-1 text-xs font-semibold transition-all
								       {resourceTypeFilter === chip.id
									? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30'
									: 'bg-white/60 text-slate-600 hover:bg-white dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20'}"
							>
								{chip.label}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Release selector -->
			<div class="lg:col-span-5">
				<div class="homepage-panel h-full rounded-2xl p-5 sm:p-6">
					<h2 class="mb-1 text-lg font-bold text-slate-900 dark:text-white">EDA Releases</h2>
					<p class="mb-4 text-sm text-slate-600 dark:text-slate-400">
						Select a release to scope search and schema data.
					</p>

					<div class="space-y-4">
						{#each groupedReleases as group}
							<div>
								<div class="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
									{group.label}
								</div>
								<div class="flex flex-wrap gap-2">
									{#each group.releases.slice(0, 3) as release}
										<button
											on:click={() => handleReleaseClick(release)}
											class="homepage-release-pill group relative rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200
											       {$selectedRelease.name === release.name
												? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25'
												: 'border border-white/20 bg-white/50 text-slate-700 hover:border-cyan-400/50 hover:bg-white/80 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10'}"
										>
											{release.name}
											{#if release.default}
												<span
													class="ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide
													       {$selectedRelease.name === release.name
														? 'bg-white/20 text-white'
														: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}"
													>default</span
												>
											{/if}
										</button>
									{/each}
									{#if group.releases.length > 3}
										<div class="relative">
											<button
												on:click={() => toggleGroupShow(group.label)}
												class="release-more-btn rounded-lg border border-white/20 bg-white/40 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white/70 dark:bg-white/5 dark:text-slate-300"
											>
												+{group.releases.length - 3}
											</button>
											{#if group.showMore}
												<div
													class="absolute left-0 z-50 mt-2 min-w-[10rem] rounded-xl border border-white/20 bg-white/95 p-2 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
												>
													{#each group.releases.slice(3) as release}
														<button
															on:click={() => {
																handleReleaseClick(release);
																toggleGroupShow(group.label);
															}}
															class="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
														>
															{release.name}
														</button>
													{/each}
												</div>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<!-- Tool cards bento grid -->
		<section in:fly={{ y: 24, duration: 550, delay: 260 }}>
			<h2 class="mb-4 text-center text-sm font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
				Developer tools
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				{#each tools as tool, i}
					<button
						on:click={() => goto(tool.href)}
						class="homepage-tool-card group rounded-2xl border border-white/20 bg-white/60 p-5 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 {tool.shadow} {tool.border} dark:bg-white/5"
						style="animation-delay: {i * 80}ms"
					>
						<div
							class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br {tool.gradient} text-white shadow-lg transition-transform duration-300 group-hover:scale-110"
						>
							<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d={tool.icon}
								/>
							</svg>
						</div>
						<h3
							class="mb-1.5 text-base font-bold text-slate-900 transition-colors group-hover:text-cyan-600 dark:text-white dark:group-hover:text-cyan-300"
						>
							{tool.title}
						</h3>
						<p class="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
							{tool.description}
						</p>
						<div
							class="mt-4 flex items-center gap-1 text-xs font-semibold text-cyan-600 opacity-0 transition-all duration-300 group-hover:opacity-100 dark:text-cyan-400"
						>
							Open tool
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M17 8l4 4m0 0l-4 4m4-4H3"
								/>
							</svg>
						</div>
					</button>
				{/each}
			</div>
		</section>
	</div>
</div>
