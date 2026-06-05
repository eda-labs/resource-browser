<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';
	import { sidebarOpen, mobileSidebarOpen } from '$lib/store';
	import Theme from '$lib/components/Theme.svelte';

	export let title: string = '';
	export let subtitle: string = '';

	export let name: string = '';
	export let versionOnFocus: string = '';
	export let validVersions: string[] = [];
	export let versionDeprecated: Record<string, boolean> = {};
	export let deprecated: boolean = false;
	export let deprecatedSince: string | null = null;
	export let kind: string = '';
	export let releaseLabel: string = '';

	$: shortName = name ? name.split('.')[0] : '';
	$: groupPath = name ? name.split('.').slice(1).join('.') : '';
	$: displayKind = kind || shortName;
	$: currentRelease = $page.url.searchParams.get('release');
	$: browseHref = currentRelease ? `/?browse=true&release=${currentRelease}` : '/?browse=true';

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const changedVersion = select.value;
		const url = currentRelease
			? `/${name}/${changedVersion}?release=${currentRelease}`
			: `/${name}/${changedVersion}`;
		goto(url, { replaceState: false, keepFocus: true });
	}

	function openSidebar() {
		mobileSidebarOpen.set(true);
	}

	const isDetailPage = derived(page, ($page) => {
		const path = $page.url.pathname || '/';
		if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
		return /^\/[^\/]+\/[^\/]+$/.test(path);
	});

	function versionLabel(version: string) {
		const isLatest = validVersions.length > 0 && version === validVersions[validVersions.length - 1];
		const parts: string[] = [version];
		if (isLatest) parts.push('(latest)');
		if (versionDeprecated[version]) parts.push('(deprecated)');
		return parts.join(' ');
	}
</script>

<header
	class="app-mobile-header surface-header fixed top-0 right-0 left-0 z-50 border-b border-slate-200 bg-white shadow-sm dark:border-blue-900/40"
>
	<div
		class="mx-auto flex h-14 max-w-full items-center justify-between gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4 lg:pl-4"
	>
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
			{#if name}
				<a
					href={browseHref}
					class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-blue-600 no-underline sm:hidden dark:text-blue-400"
					aria-label="Back to browse"
				>
					←
				</a>
			{:else}
				<a href="/" class="flex shrink-0 items-center gap-2 no-underline">
					<img
						src="/images/eda.svg"
						alt="Nokia EDA"
						width="28"
						height="28"
						class="h-7 w-7 rounded sm:h-8 sm:w-8"
						loading="eager"
						fetchpriority="high"
					/>
				</a>
			{/if}

			<a href="/" class="hidden shrink-0 items-center gap-2 no-underline sm:flex">
				<img
					src="/images/eda.svg"
					alt="Nokia EDA"
					width="32"
					height="32"
					class="rounded"
					loading="eager"
					fetchpriority="high"
				/>
				<div class="hidden leading-tight md:block">
					<div class="text-sm font-semibold text-blue-600 dark:text-blue-400">Nokia EDA</div>
					<div class="text-xs text-slate-600 dark:text-slate-300">Resource Browser</div>
				</div>
			</a>

			<div class="hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-700"></div>

			{#if title}
				<div class="min-w-0">
					<div class="truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-white">{title}</div>
					{#if subtitle}
						<div class="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
					{/if}
				</div>
			{:else if name}
				<div class="min-w-0 flex-1">
					<nav
						class="mb-0.5 hidden items-center gap-1 text-xs text-slate-500 md:flex dark:text-slate-400"
						aria-label="Breadcrumb"
					>
						<a href="/" class="transition-colors hover:text-blue-600 dark:hover:text-blue-400">Home</a>
						<span aria-hidden="true">→</span>
						<a href={browseHref} class="transition-colors hover:text-blue-600 dark:hover:text-blue-400"
							>Browse</a
						>
						<span aria-hidden="true">→</span>
						<span class="truncate font-medium text-slate-700 dark:text-slate-300">{displayKind}</span>
					</nav>
					<h1 class="truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-white">
						{displayKind}
					</h1>
					<p class="hidden truncate font-mono text-xs text-slate-500 sm:block dark:text-slate-400">
						{groupPath || name}
					</p>
				</div>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
			{#if name}
				{#if releaseLabel}
					<span
						class="hidden rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 md:inline dark:bg-blue-900/30 dark:text-blue-300"
					>
						{releaseLabel}
					</span>
				{/if}

				{#if validVersions && validVersions.length > 0}
					{#if validVersions.length > 1}
						<select
							class="max-w-[6.5rem] min-h-11 rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-xs text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:max-w-none sm:px-3 sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
							bind:value={versionOnFocus}
							on:change={handleVersionChange}
							aria-label="Select resource version"
						>
							{#each validVersions as version}
								<option value={version}>{versionLabel(version)}</option>
							{/each}
						</select>
					{:else}
						<span
							class="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
						>
							{validVersions[0]}
						</span>
					{/if}
				{/if}

				{#if deprecated}
					<span
						class="hidden items-center gap-1 rounded-md bg-orange-100 px-2 py-1 text-[10px] font-semibold text-orange-700 md:inline-flex sm:text-xs dark:bg-orange-900/30 dark:text-orange-400"
						title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : 'Deprecated'}
					>
						DEPR
					</span>
				{/if}
			{/if}

			{#if $isDetailPage}
				<button
					type="button"
					on:click={openSidebar}
					class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 lg:hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
					aria-label="Open resource navigation"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			{/if}

			<Theme />
		</div>
	</div>

	{#if $isDetailPage && !$sidebarOpen}
		<button
			type="button"
			on:click={() => sidebarOpen.open()}
			class="fixed top-[4.25rem] left-2 z-[60] hidden min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-lg transition-all hover:bg-slate-50 sm:top-[4.5rem] lg:flex dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
			aria-label="Open sidebar"
		>
			<svg class="h-4 w-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
	{/if}
</header>
