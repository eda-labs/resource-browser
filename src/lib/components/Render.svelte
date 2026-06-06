<script lang="ts">
	import type { Schema } from '$lib/structure';
	import { getDescription, getScope, hashExistDeep, getDefault } from './functions';
	import { getRequiredFields } from '$lib/schema/requiredFields';

	import Tree from './Tree.svelte';

	export let hash: string = '';
	export let source: string;
	export let type: string;
	export let data: Schema;
	export let showType: boolean = true;
	export let compact: boolean = false;
	export let onResourcePage: boolean = false;
	export let resourceName: string = '';
	export let resourceVersion: string = '';
	export let releaseName: string = '';
	export let showDiffIndicator: boolean = false;
	export let forceExpandAll: boolean = false;

	const desc = getDescription(data);
	const scope = getScope(data);
	const defaultVal = getDefault(data);

	const borderColor =
		type === 'status'
			? 'border-emerald-300 dark:border-emerald-800'
			: 'border-slate-200 dark:border-slate-600';
</script>

{#if showType}
	<p class="mb-0 py-1 text-sm font-medium text-slate-700 dark:text-slate-300">{type.toUpperCase()}</p>
{/if}
<div class="relative isolate overflow-x-hidden rounded-lg">
	<ul class="ml-1 border-l px-2 sm:ml-2 sm:px-3 {borderColor}">
		{#if desc}
			<li
				class="px-1 pt-1.5 text-sm leading-relaxed whitespace-normal text-slate-600 dark:text-slate-400"
			>
				{desc}
			</li>
		{/if}
		{#if 'properties' in scope}
			<div class="font-fira text-sm leading-relaxed">
				{#each Object.entries(scope.properties) as [key, folder]}
					{@const requiredList = getRequiredFields(scope)}
					<Tree
						{hash}
						{source}
						{key}
						{folder}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={forceExpandAll || hashExistDeep(hash, `${type}.${key}`)}
						{compact}
						{onResourcePage}
						{resourceName}
						{resourceVersion}
						{releaseName}
						{showDiffIndicator}
						{forceExpandAll}
					/>
				{/each}
			</div>
		{/if}
	</ul>
</div>
