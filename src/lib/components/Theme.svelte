<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	let darkMode = false;

	onMount(() => {
		if (browser) {
			// Check local storage or system preference
			if (
				localStorage.theme === 'dark' ||
				(!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
			) {
				darkMode = true;
				document.documentElement.classList.add('dark');
			} else {
				darkMode = false;
				document.documentElement.classList.remove('dark');
			}
		}
	});

	const toggleDarkMode = () => {
		darkMode = !darkMode;
		if (darkMode) {
			document.documentElement.classList.add('dark');
			localStorage.setItem('theme', 'dark');
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.setItem('theme', 'light');
		}
	};
</script>

<button
	on:click={toggleDarkMode}
	aria-pressed={darkMode}
	class="theme-toggle"
	aria-label="Toggle Dark Mode"
>
	<span class="sr-only">Toggle theme</span>
	<span class="theme-track" aria-hidden="true">
		<span class="theme-thumb" class:is-dark={darkMode} aria-hidden="true">
			{#if darkMode}
				<!-- Moon (white stroke) -->
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
				</svg>
			{:else}
				<!-- Sun -->
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
				</svg>
			{/if}
		</span>
	</span>
</button>
