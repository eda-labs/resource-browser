<script lang="ts">
  // Compact inline credits: logos + links (no copyright lines)
  export let compact: boolean = false;
</script>

<div class={`text-center text-xs text-gray-400 dark:text-gray-300 ${compact ? 'mt-2 mb-2' : 'mt-6 mb-6'}`}>
  <div class="max-w-2xl mx-auto px-4">
    <div class="flex items-center justify-center gap-4">
      <!-- GitHub icon (exact from crd.eda.dev) - linked to the repo -->
      <a href="https://github.com/eda-labs/resource-browser" target="_blank" rel="noopener noreferrer" class="hover:text-gray-300" aria-label="GitHub repository">
        <svg class="h-5 w-5 text-white hover:text-gray-300 inline-flex" fill="currentColor" viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12.026 2c-5.509 0-9.974 4.465-9.974 9.974 0 4.406 2.857 8.145 6.821 9.465.499.09.679-.217.679-.481 0-.237-.008-.865-.011-1.696-2.775.602-3.361-1.338-3.361-1.338-.452-1.152-1.107-1.459-1.107-1.459-.905-.619.069-.605.069-.605 1.002.07 1.527 1.028 1.527 1.028.89 1.524 2.336 1.084 2.902.829.091-.645.351-1.085.635-1.334-2.214-.251-4.542-1.107-4.542-4.93 0-1.087.389-1.979 1.024-2.675-.101-.253-.446-1.268.099-2.64 0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336 9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021.545 1.372.203 2.387.099 2.64.64.696 1.024 1.587 1.024 2.675 0 3.833-2.33 4.675-4.552 4.922.355.308.675.916.675 1.846 0 1.334-.012 2.41-.012 2.737 0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974 22 6.465 17.535 2 12.026 2z"/></svg>
        <span class="sr-only">GitHub</span>
      </a>

      <!-- Discord icon (exact from crd.eda.dev) - community link -->
      <a href="https://eda.dev/discord" target="_blank" rel="noopener noreferrer" class="hover:text-gray-300" aria-label="Community Discord">
        <svg class="h-5 w-5 text-white hover:text-gray-300 inline-flex" fill="currentColor" viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18.942 5.556a16.3 16.3 0 0 0-4.126-1.3 12.04 12.04 0 0 0-.529 1.1 15.175 15.175 0 0 0-4.573 0 11.586 11.586 0 0 0-.535-1.1 16.274 16.274 0 0 0-4.129 1.3 17.392 17.392 0 0 0-2.868 11.662 15.785 15.785 0 0 0 4.963 2.521c.41-.564.773-1.16 1.084-1.785a10.638 10.638 0 0 1-1.706-.83c.143-.106.283-.217.418-.331a11.664 11.664 0 0 0 10.118 0c.137.114.277.225.418.331-.544.328-1.116.606-1.71.832a12.58 12.58 0 0 0 1.084 1.785 16.46 16.46 0 0 0 5.064-2.595 17.286 17.286 0 0 0-2.973-11.59ZM8.678 14.813a1.94 1.94 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.918 1.918 0 0 1 1.8 2.047 1.929 1.929 0 0 1-1.8 2.045Zm6.644 0a1.94 1.94 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.919 1.919 0 0 1 1.8 2.047 1.93 1.93 0 0 1-1.8 2.045Z"/></svg>
        <span class="sr-only">Community</span>
      </a>

      <!-- Documentation icon (exact from crd.eda.dev) - docs link -->
      <a href="https://docs.eda.dev" target="_blank" rel="noopener noreferrer" class="hover:text-gray-300" aria-label="Documentation">
        <svg class="h-5 w-5 text-white hover:text-gray-300 inline-flex origin-center scale-80 transform" fill="currentColor" viewBox="556.382 193.2939 90 96.7689" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M 0 0.000011 L 0 125.8460006714 L 19.482088089 125.8460006714 L 19.4820976257 42.6795005798 L 120.7220535278 129.7931976318 L 120.7220535278 103.7016983032 L 0 0.000011 Z" transform="matrix(0.745513916015625, 0, 0, 0.7455624938011169, 556.3819580078125, 193.29393005371094)"></path></svg>
      </a>

      <!-- (Removed CRD site text link per request) -->
    </div>
  </div>
</div>
