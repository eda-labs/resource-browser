<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { derived } from 'svelte/store';
	import { sidebarOpen } from '$lib/store';
	import Theme from '$lib/components/Theme.svelte';

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
	class="fixed top-0 right-0 left-0 z-30 h-14 border-b border-white/10 bg-white/5 shadow-lg backdrop-blur-sm md:h-16 dark:border-white/10 dark:bg-transparent"
>
	<!-- Logo / app identity stays pinned to the far left edge (desktop only) -->
	<div class="absolute inset-y-0 left-0 hidden items-center pl-4 lg:flex">
		<a href="/" class="flex items-center gap-2 no-underline">
			<img
				src="/images/eda.svg"
				alt="Nokia EDA"
				width="32"
				height="32"
				class="rounded"
				loading="eager"
				fetchpriority="high"
			/>
			<div class="hidden leading-tight xl:block">
				<div class="text-sm font-semibold text-blue-400 dark:text-blue-400">Nokia EDA</div>
				<div class="text-xs text-amber-500 dark:text-gray-300">Resource Browser</div>
			</div>
		</a>
	</div>

	{#if $isDetailPage && !$sidebarOpen}
		<!-- Desktop reopen button (visible on lg and up) -->
		<button
			on:click={openSidebar}
			class="fixed top-16 left-2 z-[60] hidden rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg transition-all hover:bg-gray-50 lg:flex dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
			aria-label="Open sidebar"
		>
			<svg
				class="h-4 w-4 text-gray-700 dark:text-gray-200"
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

	<div class="mx-auto h-full max-w-7xl px-3 lg:pl-20">
		<div class="flex h-full items-center justify-center gap-2 lg:justify-between">
			<div class="min-w-0 text-center lg:text-left">
				<!-- Mobile: compact app identity (centered, smaller text) -->
				<div class="mb-1 block w-full lg:hidden">
					<a
						href="/"
						class="inline-flex items-center gap-2 text-gray-900 no-underline dark:text-white"
					>
						<img
							src="/images/eda.svg"
							alt="Nokia EDA"
							width="20"
							height="20"
							class="h-5 w-5 rounded"
							loading="eager"
							fetchpriority="high"
						/>
						<div class="text-left leading-tight">
							<div class="text-[11px] font-semibold text-blue-400">Nokia EDA</div>
							<div class="text-[9px] text-amber-500 dark:text-white/80">Resource Browser</div>
						</div>
					</a>
				</div>
				{#if title}
					<div
						class="w-full text-center text-sm font-extrabold text-blue-600 sm:text-base lg:w-auto lg:text-left lg:text-lg dark:text-white"
					>
						{title}
					</div>
					{#if subtitle}
						<div
							class="mt-0.5 w-full text-center text-[10px] text-gray-300 sm:text-xs lg:w-auto lg:text-left dark:text-gray-300"
						>
							{subtitle}
						</div>
					{/if}
				{:else if name}
					<div class="flex items-center justify-center gap-2 lg:justify-start">
						<div class="min-w-0 text-center lg:text-left">
							<h1
								class="truncate text-sm font-extrabold leading-tight text-blue-600 sm:text-base lg:text-lg dark:text-white"
							>
								{kind || shortName}
							</h1>
							<p
								class="mt-0.5 flex items-center justify-center gap-1.5 truncate text-[10px] text-gray-300 sm:text-xs lg:justify-start dark:text-gray-300"
							>
								<span class="truncate text-amber-500 dark:text-gray-300">{groupPath || name}</span>
								<span class="text-gray-400">/</span>
								<span class="flex items-center">
									{#if validVersions && validVersions.length > 1}
										<select
											class="w-auto rounded-md border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-900 shadow-sm transition-all hover:border-cyan-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 sm:text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
											bind:value={versionOnFocus}
											on:change={handleVersionChange}
											aria-label="Select resource version"
										>
											{#each validVersions as version}
												<option value={version}>{version}</option>
											{/each}
										</select>
									{:else}
										<span
											class="font-nokia-text text-[10px] font-bold text-blue-700 sm:text-xs dark:text-blue-300"
											>{validVersions && validVersions[0]}</span
										>
									{/if}

									{#if deprecated}
										<span
											class="ml-2 inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700 sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300"
											title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : ''}
										>
											<svg
												class="h-3 w-3 text-orange-600 dark:text-orange-400"
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
											<span class="hidden sm:inline"
												>DEPRECATED{#if deprecatedSince}<span
														class="ml-1 text-[9px] font-normal text-orange-600 dark:text-orange-400"
														>since {deprecatedSince}</span
													>{/if}</span
											>
											<span class="sm:hidden">DEPR</span>
										</span>
									{/if}
								</span>
							</p>
						</div>

						<!-- deprecated badge moved inline with version selector -->
					</div>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<Theme />
			</div>
		</div>
	</div>
</nav>
