<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import AnimatedBackground from '$lib/components/AnimatedBackground.svelte';
	import { page } from '$app/stores';

	let { children } = $props();
	
	// Show sidebar on resource detail pages
	let isDetailPage = $derived($page.url.pathname !== '/');
</script>

<AnimatedBackground />

{#if isDetailPage}
	<div class="flex h-screen">
		<Sidebar />
		<div class="flex-1 overflow-auto pb-16">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="pb-16">
		{@render children()}
	</div>
{/if}
