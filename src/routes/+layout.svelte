<script lang="ts">
	import '../app.css';

	import { initTheme } from '$lib/theme';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';

	let { children } = $props();

	// Show sidebar on resource detail pages (only when path looks like /<resource>/<version>)
	const isDetailPage = derived(page, ($page) => {
		const path = $page.url.pathname || '/';
		// Explicit exclusion for certain routes that should never show the sidebar
		if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
		// Match two segments like /resource/version; do not show for single-segment paths
		return /^\/[^\/]+\/[^\/]+$/.test(path);
	});

	// Only show the global footer on the homepage
	// no special-case: show credits on all pages
	onMount(() => initTheme());
</script>

{#if $isDetailPage}
	<div class="flex h-screen overflow-hidden bg-white pt-14 md:pt-16 dark:bg-slate-900">
		<Sidebar />
		<div class="flex-1 overflow-y-auto bg-white px-3 pb-16 md:px-4 dark:bg-slate-900">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="h-screen w-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
		{@render children()}
	</div>
{/if}
