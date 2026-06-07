<script lang="ts">
	import { highlightSegments } from './presentation';

	let { text = '', query = '' }: { text: string; query?: string } = $props();

	const segments = $derived(highlightSegments(text, query));
</script>

{#each segments as segment, i (i)}
	{#if segment.match}<mark class="rn-highlight">{segment.text}</mark>{:else}{segment.text}{/if}
{/each}
