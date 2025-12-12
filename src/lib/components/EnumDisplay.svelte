<script lang="ts">
	export let text: string = '';
</script>

{#if text}
	<code
		title={text}
		class="block truncate overflow-hidden rounded bg-white/50 px-1.5 py-0.5 text-xs whitespace-nowrap text-violet-900 dark:bg-black/20 dark:text-violet-300"
		>{text}</code
	>
{/if}
