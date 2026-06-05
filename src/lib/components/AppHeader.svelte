<script lang="ts">
	import Theme from '$lib/components/Theme.svelte';

	/** Small badge beside brand, e.g. "CRD Catalog" */
	export let contextBadge = '';
	/** Center context title — resource kind or tool page title */
	export let contextTitle = '';
	export let contextSubtitle = '';
	/** Fixed (detail pages) vs sticky (homepage / browse) */
	export let fixed = false;
	/** Optional handler when logo is clicked (e.g. exit browse mode) */
	export let onLogoClick: ((e: MouseEvent) => void) | undefined = undefined;
</script>

<header
	class="app-header app-mobile-header z-50 border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900/95
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

			{#if contextBadge}
				<span
					class="hidden shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 sm:inline dark:bg-blue-900/30 dark:text-blue-300"
				>
					{contextBadge}
				</span>
			{/if}
		</div>

		<!-- Center: page context (desktop) -->
		{#if contextTitle}
			<div class="hidden min-w-0 flex-1 items-center justify-center px-2 md:flex">
				<div class="min-w-0 text-center">
					<div class="truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-white">
						{contextTitle}
					</div>
					{#if contextSubtitle}
						<div class="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
							{contextSubtitle}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Right: mobile context + actions + theme -->
		<div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
			{#if contextTitle}
				<div
					class="max-w-[7rem] min-w-0 truncate text-sm font-semibold text-slate-900 sm:max-w-[10rem] md:hidden dark:text-white"
				>
					{contextTitle}
				</div>
			{/if}
			{#if contextBadge}
				<span
					class="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 sm:hidden dark:bg-blue-900/30 dark:text-blue-300"
				>
					{contextBadge}
				</span>
			{/if}
			<slot name="actions" />
			<Theme />
		</div>
	</div>

	<slot />
</header>
