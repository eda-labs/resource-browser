<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';
	import { sidebarOpen } from '$lib/store';

	export let title: string = '';
	export let subtitle: string = '';

	// Resource-specific props (optional). When `title` is empty, show resource info.
	export let name: string = '';
	export let versionOnFocus: string = '';
	export let validVersions: string[] = [];
	export let deprecated: boolean = false;
	export let deprecatedSince: string | null = null;
	export let kind: string = '';

	$: shortName = name ? name.split('.')[0] : '';
	$: groupPath = name ? name.split('.').slice(1).join('.') : '';

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
		sidebarOpen.open();
	}

	// Show reopen button only on detail pages (same rule as +layout.svelte)
	const isDetailPage = derived(page, ($page) => {
		const path = $page.url.pathname || '/';
		if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
		return /^\/[^\/]+\/[^\/]+$/.test(path);
	});
</script>

<nav
	class="fixed top-0 right-0 left-0 z-30 h-16 border-b border-white/10 bg-white/5 shadow-lg backdrop-blur-sm md:h-20 dark:border-white/10 dark:bg-transparent"
>
	<!-- Logo / app identity stays pinned to the far left edge (desktop only) -->
	<div class="absolute inset-y-0 left-0 flex hidden items-center pl-4 sm:flex sm:pl-20">
		<a href="/" class="flex items-center gap-3 no-underline">
			<img
				src="/images/eda.svg"
				alt="Nokia EDA"
				width="40"
				height="40"
				class="rounded"
				loading="eager"
				fetchpriority="high"
			/>
			<div class="hidden leading-tight sm:block">
				<div class="text-sm font-semibold text-yellow-400 dark:text-yellow-400">Nokia EDA</div>
				<div class="text-xs text-gray-900 dark:text-gray-300">Resource Browser</div>
			</div>
		</a>
	</div>

	{#if $isDetailPage && !$sidebarOpen}
		<!-- Desktop reopen button (visible on lg and up) -->
		<button
			on:click={openSidebar}
			class="no-blur fixed top-20 left-3 z-60 hidden rounded-lg border border-gray-200 bg-white p-2 shadow-xl transition-colors hover:bg-gray-50 lg:flex dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
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

	<div class="mx-auto h-full max-w-7xl px-4 pl-4 sm:pl-20 md:pl-24 lg:pl-28">
		<div class="flex h-full items-center justify-center gap-3 sm:justify-between">
			<div class="min-w-0 text-center sm:text-left">
				<!-- Mobile: compact app identity (left-aligned, smaller text) -->
				<div class="mb-0.5 block w-full sm:hidden">
					<a
						href="/"
						class="inline-flex items-center gap-3 text-white no-underline dark:text-white"
					>
						<img
							src="/images/eda.svg"
							alt="Nokia EDA"
							width="24"
							height="24"
							class="h-6 w-6 rounded"
							loading="eager"
							fetchpriority="high"
						/>
						<div class="text-left leading-tight">
							<div class="text-xs font-semibold text-white">Nokia EDA</div>
							<div class="text-[11px] text-white/80">Resource Browser</div>
						</div>
					</a>
				</div>
				{#if title}
					<div
						class="w-full text-center text-base font-extrabold text-gray-900 sm:w-auto sm:text-left sm:text-xl dark:text-white"
					>
						{title}
					</div>
					{#if subtitle}
						<div
							class="mt-1 w-full text-center text-xs text-gray-600 sm:w-auto sm:text-left sm:text-sm dark:text-gray-300"
						>
							{subtitle}
						</div>
					{/if}
				{:else if name}
					<div class="flex items-center justify-center gap-4 sm:justify-start">
						<div class="min-w-0 text-center sm:text-left">
							<h1
								class="truncate text-lg leading-tight font-extrabold text-gray-900 sm:text-xl dark:text-white"
							>
								{kind || shortName}
							</h1>
							<p
								class="mt-1 flex -translate-y-0.5 items-center gap-2 truncate text-sm text-gray-600 dark:text-gray-300"
							>
								<span class="truncate">{groupPath || name}</span>
								<span class="text-gray-400">/</span>
								<span class="flex items-center">
									{#if validVersions && validVersions.length > 1}
										<select
											class="w-full rounded-lg border-2 border-gray-300 bg-black/30 px-3 py-1 text-xs text-white transition-colors focus:border-purple-500 focus:bg-white focus:text-gray-900 focus:ring-2 focus:ring-purple-500 sm:px-4 sm:py-2 sm:text-sm dark:border-gray-600 dark:focus:bg-gray-700 dark:focus:text-white"
											style="z-index:1000; width: auto;"
											bind:value={versionOnFocus}
											on:change={handleVersionChange}
											aria-label="Select resource version"
										>
											{#each validVersions as version}
												<option value={version} class="bg-white dark:bg-gray-800">{version}</option>
											{/each}
										</select>
									{:else}
										<span
											class="font-nokia-text text-xs font-bold text-blue-700 sm:text-sm dark:text-blue-300"
											>{validVersions && validVersions[0]}</span
										>
									{/if}

									{#if deprecated}
										<span
											class="ml-3 inline-flex items-center gap-2 rounded-lg border-2 border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300"
											title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : ''}
										>
											<svg
												class="h-4 w-4 text-orange-600 dark:text-orange-400"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
												/></svg
											>
											<span
												>DEPRECATED{#if deprecatedSince}<span
														class="ml-2 text-xs font-normal text-orange-600 dark:text-orange-400"
														>since {deprecatedSince}</span
													>{/if}</span
											>
										</span>
									{/if}
								</span>
							</p>
						</div>

						<!-- deprecated badge moved inline with version selector -->
					</div>
				{/if}
			</div>
			<div class=""></div>
		</div>
	</div>
</nav>
