<script lang="ts">
	import '../app.css';

	import Sidebar from '$lib/components/Sidebar.svelte';
	let AnimatedBackground: any = $state(null);
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
	onMount(async () => {
		// Defer loading heavy animated background until the browser is idle so it doesn't
		// compete with LCP-critical assets and main-thread tasks.
		if (typeof (window as any).requestIdleCallback === 'function') {
			(window as any).requestIdleCallback(async () => {
				const m = await import('$lib/components/AnimatedBackground.svelte');
				AnimatedBackground = m.default;
			});
		} else {
			setTimeout(async () => {
				const m = await import('$lib/components/AnimatedBackground.svelte');
				AnimatedBackground = m.default;
			}, 300);
		}
	});
</script>

{#if AnimatedBackground}
	<AnimatedBackground />
{/if}

<!-- Inline LCP hero background image: place an image early in the DOM so it can be preloaded and measured
		 by the browser as the LCP candidate. We use a dedicated container so styles can keep the gradient
		 overlay and the content flush on top of the image. -->
<div class="header-bg-container" aria-hidden="true">
	<picture>
		<!-- Desktop: prefer a larger photo optimized for the layout -->
		<source
			media="(min-width: 1200px)"
			type="image/webp"
			srcset="/images/background-1920.webp 1920w, /images/background-1600.webp 1600w, /images/background-1280.webp 1280w"
			sizes="(min-width:1200px) 1920px"
		/>
		<!-- Tablet / small desktop: mid-sized image -->
		<source
			media="(min-width: 769px)"
			type="image/webp"
			srcset="/images/background-1280.webp 1280w, /images/background-1024.webp 1024w"
			sizes="(min-width:769px) 1280px"
		/>
		<!-- Small devices: use a smaller optimized image to reduce downloads and LCP impact -->
		<source
			media="(max-width: 768px)"
			type="image/webp"
			srcset="/images/background-640.webp 640w, /images/background-480.webp 480w, /images/background-360.webp 360w"
			sizes="100vw"
		/>
		<!-- Fallback small image for non-WebP capable clients; default optimised mobile image -->
		<img
			src="/images/background-small.webp"
			srcset="/images/background-360.webp 360w, /images/background-640.webp 640w"
			sizes="100vw"
			alt=""
			class="header-bg-img"
			loading="eager"
			fetchpriority="high"
			width="1920"
			height="720"
		/>
	</picture>
</div>

{#if $isDetailPage}
	<div class="has-header-img flex h-screen pt-14 md:pt-16">
		<Sidebar />
		<div class="flex-1 overflow-auto px-3 pb-16 md:px-4">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="has-header-img px-3 pt-14 pb-16 md:px-4 md:pt-16">
		{@render children()}
	</div>
{/if}
