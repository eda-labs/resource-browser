<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { sidebarOpen } from '$lib/store';

	export let name: string;
	export let versionOnFocus: string;
	export let validVersions: string[];
	export let deprecated: boolean;
	export let deprecatedSince: string | null = null;
	export let kind: string;
	export let showPageTitle: boolean = true;
	export let isFixed: boolean = true;
	// 'sidebarOpen' was unused here — removed to prevent Svelte compile warnings

	// Extract short name and group path from full name
	$: shortName = name.split('.')[0];
	$: groupPath = name.split('.').slice(1).join('.');

	function handleVersionChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const changedVersion = select.value;
		// Use goto with preserve to avoid full page reload and keep sidebar state
		const currentRelease = $page.url.searchParams.get('release');
		const url = currentRelease
			? `/${name}/${changedVersion}?release=${currentRelease}`
			: `/${name}/${changedVersion}`;
		goto(url, { replaceState: false, keepFocus: true });
	}
</script>

<nav class={isFixed ? 'fixed top-0 z-20 w-screen' : 'relative w-full'}>
	<!-- Nav background that expands left when sidebar is closed; stays aligned to sidebar when open -->
	<div
		class="pointer-events-none absolute inset-y-0 z-10 bg-transparent transition-all duration-300 dark:bg-transparent"
		style="left: 0; right: 0;"
	></div>
	<div class="relative z-20 mx-auto max-w-full px-4 py-3 pl-20 sm:px-6 lg:pl-24">
		<div class="flex items-center justify-between gap-6">
			{#if !$sidebarOpen}
				<!-- Reopen sidebar - fixed top-left on desktop to match mobile hamburger -->
				<button
					class="no-blur fixed top-3 left-3 z-60 hidden rounded-lg border border-gray-200 bg-white p-2 shadow-xl transition-colors hover:bg-gray-50 lg:flex dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
					on:click={() => sidebarOpen.open()}
					aria-label="Open sidebar"
				>
					<svg
						class="h-5 w-5 text-gray-700 dark:text-gray-200"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					</svg>
				</button>
			{/if}
			<!-- Left side - Resource Info -->
			<div class="flex min-w-0 flex-1 items-center gap-4">
				<!-- Resource Info: show kind then full name with version selector -->
				{#if showPageTitle}
					<div class="min-w-0">
						<h2
							class="font-nokia-headline truncate text-xl leading-tight font-bold text-slate-900 sm:text-3xl dark:text-slate-100"
						>
							{kind || shortName}
						</h2>
						<p
							class="mt-0 flex -translate-y-0.5 items-center gap-2 truncate text-sm font-medium text-gray-500 sm:text-base dark:text-gray-300"
						>
							<span class="truncate">{groupPath || name}</span>
							<span class="text-gray-400">/</span>
							<!-- Version selector inline -->
							<span class="flex items-center">
								{#if validVersions.length > 1}
									<select
										class="select-pro font-nokia-text bg-transparent text-xs font-bold text-blue-700 sm:text-sm dark:text-blue-300"
										bind:value={versionOnFocus}
										on:change={handleVersionChange}
									>
										{#each validVersions as version}
											<option value={version} class="bg-white dark:bg-gray-800">{version}</option>
										{/each}
									</select>
								{:else}
									<span
										class="font-nokia-text text-xs font-bold text-blue-700 sm:text-sm dark:text-blue-300"
										>{validVersions[0]}</span
									>
								{/if}
							</span>
						</p>
					</div>
				{/if}

				{#if deprecated}
					<div
						class="relative z-30 hidden shrink-0 -translate-y-1 items-center gap-1.5 self-end rounded-lg border border-orange-300 bg-orange-50 px-2 py-1 sm:flex sm:px-4 sm:py-2 dark:border-orange-700 dark:bg-orange-900/30"
						title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : 'Deprecated'}
					>
						<svg
							class="h-3 w-3 text-orange-600 sm:h-4 sm:w-4 dark:text-orange-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<span
							class="font-nokia-text text-xs font-bold text-orange-700 sm:text-sm dark:text-orange-400"
							>DEPRECATED</span
						>
					</div>
				{/if}
			</div>
		</div>
	</div>
</nav>
