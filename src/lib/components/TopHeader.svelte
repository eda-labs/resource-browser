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
  export const deprecatedSince: string | null = null;
  export let kind: string = '';

  $: shortName = name ? name.split('.')[0] : '';
  $: groupPath = name ? name.split('.').slice(1).join('.') : '';

  function handleVersionChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const changedVersion = select.value;
    const currentRelease = $page.url.searchParams.get('release');
    const url = currentRelease ? `/${name}/${changedVersion}?release=${currentRelease}` : `/${name}/${changedVersion}`;
    goto(url, { replaceState: false, keepFocus: true });
  }

  function openSidebar() {
    sidebarOpen.open();
  }

  // Show reopen button only on detail pages (same rule as +layout.svelte)
  const isDetailPage = derived(page, $page => {
    const path = $page.url.pathname || '/';
    if (path.startsWith('/bulk-diff') || path.startsWith('/spec-search')) return false;
    return /^\/[^\/]+\/[^\/]+$/.test(path);
  });
</script>

<nav class="fixed top-0 left-0 right-0 z-30 h-16 md:h-20 border-b border-white/10 dark:border-white/10 bg-white/5 dark:bg-transparent backdrop-blur-sm shadow-lg">
  <!-- Logo / app identity stays pinned to the far left edge (desktop only) -->
  <div class="absolute left-0 inset-y-0 flex items-center pl-4 sm:pl-20 hidden sm:flex">
    <a href="/" class="flex items-center gap-3 no-underline">
      <img src="/images/eda.svg" alt="Nokia EDA" width="40" height="40" class="rounded" loading="eager" fetchpriority="high" />
      <div class="leading-tight hidden sm:block">
        <div class="text-sm font-semibold text-yellow-400 dark:text-yellow-400">Nokia EDA</div>
        <div class="text-xs text-gray-900 dark:text-gray-300">Resource Browser</div>
      </div>
    </a>
  </div>

  {#if $isDetailPage && !$sidebarOpen}
    <!-- Desktop reopen button (visible on lg and up) -->
    <button
      on:click={openSidebar}
      class="hidden lg:flex fixed top-20 left-3 z-60 no-blur p-2 rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      aria-label="Open sidebar"
    >
      <svg class="h-5 w-5 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  {/if}

  <div class="max-w-7xl mx-auto px-4 pl-4 sm:pl-20 md:pl-24 lg:pl-28 h-full">
    <div class="flex items-center justify-center sm:justify-between gap-3 h-full">
      <div class="min-w-0 text-center sm:text-left">
          <!-- Mobile: compact app identity (left-aligned, smaller text) -->
          <div class="block sm:hidden w-full mb-0.5">
            <a href="/" class="inline-flex items-center gap-3 no-underline text-white dark:text-white">
              <img src="/images/eda.svg" alt="Nokia EDA" width="24" height="24" class="w-6 h-6 rounded" loading="eager" fetchpriority="high" />
              <div class="leading-tight text-left">
                <div class="text-xs font-semibold text-white">Nokia EDA</div>
                <div class="text-[11px] text-white/80">Resource Browser</div>
              </div>
            </a>
          </div>
        {#if title}
          <div class="text-base sm:text-xl font-extrabold text-gray-900 dark:text-white w-full text-center sm:text-left sm:w-auto">{title}</div>
          {#if subtitle}
              <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1 w-full text-center sm:text-left sm:w-auto">{subtitle}</div>
            {/if}
        {:else if name}
          <div class="flex items-center gap-4 justify-center sm:justify-start">
            <div class="min-w-0 text-center sm:text-left">
              <h1 class="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white leading-tight truncate">{kind || shortName}</h1>
              <p class="text-sm text-gray-600 dark:text-gray-300 mt-1 truncate flex items-center gap-2 -translate-y-0.5">
                <span class="truncate">{groupPath || name}</span>
                <span class="text-gray-400">/</span>
                <span class="flex items-center">
                    {#if validVersions && validVersions.length > 1}
                    <select
                      class="w-full px-3 sm:px-4 py-1 sm:py-2 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-black/30 text-white focus:bg-white dark:focus:bg-gray-700 focus:text-gray-900 dark:focus:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors text-xs sm:text-sm"
                      style="z-index:1000; width: auto;"
                      bind:value={versionOnFocus}
                      on:change={handleVersionChange}
                    >
                      {#each validVersions as version}
                        <option value={version} class="bg-white dark:bg-gray-800">{version}</option>
                      {/each}
                    </select>
                  {:else}
                    <span class="text-xs sm:text-sm font-bold text-blue-700 dark:text-blue-300 font-nokia-text">{validVersions && validVersions[0]}</span>
                  {/if}

                  {#if deprecated}
                    <span class="ml-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-200 dark:border-orange-700 text-sm font-semibold text-orange-700 dark:text-orange-300">
                      <svg class="h-4 w-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <span>DEPRECATED</span>
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
