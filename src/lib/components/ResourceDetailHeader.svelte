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

<div
	class="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 dark:border-blue-900/40 dark:bg-[#0f2a48]/88"
>
	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-base font-semibold text-slate-900 sm:text-lg dark:text-white">{kind}</h2>
			{#if releaseLabel}
				<span
					class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
				>
					{releaseLabel}
				</span>
			{/if}
			{#if deprecated}
				<span
					class="inline-flex items-center gap-1 rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
					title={deprecatedSince ? `Deprecated since ${deprecatedSince}` : 'Deprecated'}
				>
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					Deprecated{#if deprecatedSince}<span class="font-normal opacity-80"> · since {deprecatedSince}</span>{/if}
				</span>
			{/if}
		</div>

		<dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 sm:gap-2 lg:grid-cols-3">
			<div class="min-w-0 space-y-0.5">
				<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">API Group</dt>
				<dd>
					<button
						type="button"
						on:click={() => copyToClipboard(group, 'group')}
						class="group inline-flex max-w-full min-h-11 items-center gap-1 rounded-md px-1 py-1 font-mono text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
						title="Copy API group"
					>
						<span class="truncate">{group}</span>
						{#if copiedField === 'group'}
							<span class="shrink-0 text-[10px] font-sans text-blue-600 dark:text-blue-400">Copied</span>
						{/if}
					</button>
				</dd>
			</div>
			<div class="space-y-0.5">
				<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">Version</dt>
				<dd>
					<span
						class="inline-flex min-h-11 items-center rounded-md bg-slate-100 px-2.5 py-1 font-mono text-sm font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
					>
						{versionOnFocus}
					</span>
				</dd>
			</div>
			<div class="min-w-0 space-y-0.5 sm:col-span-2 lg:col-span-1">
				<dt class="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">Resource</dt>
				<dd>
					<button
						type="button"
						on:click={() => copyToClipboard(name, 'name')}
						class="inline-flex max-w-full min-h-11 items-center gap-1 truncate rounded-md px-1 py-1 font-mono text-sm text-slate-600 transition-colors hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
						title="Copy resource name"
					>
						<span class="truncate">{name}</span>
						{#if copiedField === 'name'}
							<span class="shrink-0 text-[10px] font-sans text-blue-600 dark:text-blue-400">Copied</span>
						{/if}
					</button>
				</dd>
			</div>
		</dl>
	</div>
</div>
