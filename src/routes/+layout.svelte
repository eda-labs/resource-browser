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
	<div class="page-shell flex min-h-[100dvh] flex-col bg-gray-50 lg:h-screen lg:overflow-hidden">
		<div class="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
			<Sidebar />
			<div
				class="page-shell min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 px-3 pt-14 pb-[max(4rem,env(safe-area-inset-bottom))] sm:pt-16 md:px-4"
			>
				{@render children()}
			</div>
		</div>
	</div>
{:else}
	<div
		class="page-shell h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-gray-50 pb-[env(safe-area-inset-bottom)]"
	>
		{@render children()}
	</div>
{/if}
