<script lang="ts">
	import { browser } from '$app/environment';

	export let kind = '';
	export let group = '';
	export let name = '';
	export let versionOnFocus = '';
	export let releaseLabel = '';
	export let deprecated = false;
	export let deprecatedSince: string | null = null;

	let copiedField: 'group' | 'name' | null = null;
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyToClipboard(text: string, field: 'group' | 'name') {
		if (!browser || !text) return;
		try {
			await navigator.clipboard.writeText(text);
			copiedField = field;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copiedField = null;
			}, 2000);
		} catch {
			/* ignore */
		}
	}
</script>

<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
	<button
		type="button"
		on:click={() => copyToClipboard(group, 'group')}
		class="inline-flex max-w-full items-center gap-1 rounded px-0.5 font-mono text-slate-600 transition-colors hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
		title="Copy API group"
	>
		<span class="truncate">{group}</span>
		{#if copiedField === 'group'}
			<span class="shrink-0 text-[10px] font-sans text-blue-600 dark:text-blue-400">Copied</span>
		{/if}
	</button>

	<span class="text-slate-300 select-none dark:text-slate-600" aria-hidden="true">·</span>

	<span
		class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
	>
		{versionOnFocus}
	</span>

	{#if deprecated}
		<span
			class="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-orange-700 sm:text-xs dark:bg-orange-900/30 dark:text-orange-400"
			title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : 'Deprecated'}
		>
			DEPRECATED{#if deprecatedSince}<span class="font-normal opacity-80"> · {deprecatedSince}</span>{/if}
		</span>
	{/if}
</div>
