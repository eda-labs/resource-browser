<script lang="ts">
	import '../app.css';
	import Footer from '$lib/components/Footer.svelte'
	import Sidebar from '$lib/components/Sidebar.svelte';
	import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';

	let { children } = $props();
	
	// Show sidebar on resource detail pages (only when path looks like /<resource>/<version>)
	const isDetailPage = derived(page, $page => {
		const path = $page.url.pathname || '/';
		// Explicit exclusion for certain routes that should never show the sidebar
		if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
		// Match two segments like /resource/version; do not show for single-segment paths
		return /^\/[^\/]+\/[^\/]+$/.test(path);
	});
</script>

<AnimatedBackground />

{#if $isDetailPage}
	<div class="flex h-screen has-header-img pt-20">
		<Sidebar />
		<div class="flex-1 overflow-auto pb-16">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="pt-20 pb-16 has-header-img">
		{@render children()}
	</div>
{/if}

<Footer />
