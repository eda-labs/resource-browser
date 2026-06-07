<script lang="ts">
	import { page } from '$app/stores';
	import Theme from '$lib/components/Theme.svelte';

	/** Fixed (detail pages) vs sticky (homepage / browse) */
	export let fixed = false;
	/** Optional handler when logo is clicked (e.g. exit browse mode) */
	export let onLogoClick: ((e: MouseEvent) => void) | undefined = undefined;
	/** Show global tools navigation (default on) */
	export let showToolsNav = true;

	let mobileNavOpen = false;

	const toolsNav = [
		{ href: '/?browse=true', label: 'Catalog', match: (path: string) => path === '/' },
		{ href: '/spec-search', label: 'Spec Search', match: (path: string) => path.startsWith('/spec-search') },
		{ href: '/validate-yaml', label: 'Validate YAML', match: (path: string) => path.startsWith('/validate-yaml') },
		{ href: '/comparison', label: 'Comparison', match: (path: string) => path.startsWith('/comparison') },
		{
			href: '/dependency-map',
			label: 'Dependency Map',
			match: (path: string) => path.startsWith('/dependency-map')
		}
	] as const;

	function isNavActive(match: (path: string) => boolean): boolean {
		return match($page.url.pathname);
	}

	function catalogHref(): string {
		const release = $page.url.searchParams.get('release');
		return release ? `/?browse=true&release=${encodeURIComponent(release)}` : '/?browse=true';
	}

	function closeMobileNav() {
		mobileNavOpen = false;
	}
</script>

<header
	class="app-header app-mobile-header z-50 border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/95
	       {fixed ? 'fixed top-0 right-0 left-0' : 'sticky top-0'}"
>
	<div
		class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6"
	>
		<!-- Left: optional leading slot + brand -->
		<div class="flex min-w-0 items-center gap-2 sm:gap-3">
			<slot name="leading" />

			<a
				href="/"
				class="flex shrink-0 items-center gap-2 no-underline"
				on:click={onLogoClick}
			>
				<img
					src="/images/eda.svg"
					alt="Nokia EDA"
					width="28"
					height="28"
					class="h-7 w-7 rounded sm:h-8 sm:w-8"
					loading="eager"
					fetchpriority="high"
				/>
				<span class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
					Resource Browser
				</span>
			</a>
		</div>

		<!-- Right: actions + theme -->
		<div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
			{#if showToolsNav}
				<button
					type="button"
					class="app-header-nav-toggle flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
					aria-expanded={mobileNavOpen}
					aria-controls="app-header-tools-nav"
					aria-label={mobileNavOpen ? 'Close tools menu' : 'Open tools menu'}
					on:click={() => (mobileNavOpen = !mobileNavOpen)}
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						{#if mobileNavOpen}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						{/if}
					</svg>
				</button>
			{/if}
			<slot name="actions" />
			<Theme />
		</div>
	</div>

	{#if showToolsNav}
		<nav
			id="app-header-tools-nav"
			class="app-header-tools-nav {mobileNavOpen ? 'is-open' : ''}"
			aria-label="Tools"
		>
			<div class="app-header-tools-inner mx-auto max-w-7xl px-4 sm:px-6">
				{#each toolsNav as item (item.href)}
					{@const active = isNavActive(item.match)}
					{@const href = item.label === 'Catalog' ? catalogHref() : item.href}
					<a
						{href}
						class="app-header-tools-link {active ? 'is-active' : ''}"
						aria-current={active ? 'page' : undefined}
						on:click={closeMobileNav}
					>
						{item.label}
					</a>
				{/each}
			</div>
		</nav>
	{/if}

	<slot />
</header>
