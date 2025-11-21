<script lang="ts">
  export let title: string = '';
  export let subtitle: string = '';
</script>

<nav class="fixed top-0 left-0 right-0 z-20 border-b border-white/10 dark:border-white/10 bg-white/5 dark:bg-transparent backdrop-blur-sm shadow-lg">
  <!-- Logo / app identity stays pinned to the far left edge -->
  <div class="absolute left-0 inset-y-0 flex items-center pl-16 sm:pl-20">
    <a href="/" class="flex items-center gap-3 no-underline">
      <img src="/images/eda.svg" alt="Nokia EDA" width="40" height="40" class="rounded" />
      <div class="leading-tight hidden sm:block">
        <div class="text-sm font-semibold text-yellow-400 dark:text-yellow-400">Nokia EDA</div>
        <div class="text-xs text-gray-900 dark:text-gray-300">Resource Browser</div>
      </div>
    </a>
  </div>

  <div class="max-w-7xl mx-auto px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        {#if title}
          <div class="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white">{title}</div>
          {#if subtitle}
            <div class="text-xs text-gray-600 dark:text-gray-300 mt-1">{subtitle}</div>
          {/if}
        {/if}
      </div>
      <div class=""></div>
    </div>
  </div>
</nav>
