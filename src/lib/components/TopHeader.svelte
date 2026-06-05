<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';
	import { sidebarOpen, mobileSidebarOpen } from '$lib/store';
	import AppHeader from '$lib/components/AppHeader.svelte';

	export let name: string = '';
	export let versionOnFocus: string = '';
	export let validVersions: string[] = [];
	export let versionDeprecated: Record<string, boolean> = {};
	export let releaseLabel: string = '';

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const changedVersion = select.value;
		const currentRelease = $page.url.searchParams.get('release');
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

<AppHeader fixed={true}>
	<svelte:fragment slot="leading">
		{#if $isDetailPage}
			<button
				type="button"
				on:click={openSidebar}
				class="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 lg:hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
				aria-label="Open resource navigation"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
				</svg>
			</button>
		{/if}
	</svelte:fragment>

	<svelte:fragment slot="actions">
		{#if name}
			{#if releaseLabel}
				<span
					class="hidden shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 sm:inline dark:bg-blue-900/30 dark:text-blue-300"
				>
					{releaseLabel}
				</span>
			{/if}

			{#if validVersions && validVersions.length > 0}
				{#if validVersions.length > 1}
					<select
						class="max-w-[5.5rem] min-h-9 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 shadow-sm transition-colors hover:border-blue-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:max-w-none sm:px-2.5 sm:text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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
						class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
					>
						{validVersions[0]}
					</span>
				{/if}
			{/if}
		{/if}
	</svelte:fragment>

	{#if $isDetailPage && !$sidebarOpen}
		<button
			type="button"
			on:click={() => sidebarOpen.open()}
			class="fixed top-[4.25rem] left-4 z-[60] hidden min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-md transition-all hover:bg-slate-50 sm:top-[4.5rem] lg:flex dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
			aria-label="Open sidebar"
		>
			<svg class="h-4 w-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
	{/if}
</AppHeader>
