<script lang="ts">
	import type { Schema } from '$lib/structure';
	import { getDescription, getScope, hashExistDeep, getDefault } from './functions';

	import Tree from './Tree.svelte';

	export let hash: string = '';
	export let source: string;
	export let type: string;
	export let data: Schema;
	export let showType: boolean = true;

	const desc = getDescription(data);
	const scope = getScope(data);
	const defaultVal = getDefault(data);

	const borderColor =
		type === 'status'
			? 'border-green-400 dark:border-green-700'
			: 'border-gray-300 dark:border-gray-600';
</script>

{#if showType}
	<p class="mb-0 py-1 text-sm text-gray-900 dark:text-gray-200">{type.toUpperCase()}</p>
{/if}
<ul class="ml-2 border-l px-3 dark:bg-gray-800 {borderColor}">
	<li class="px-1 pt-1.5 text-sm font-light text-gray-600 dark:text-gray-300 whitespace-normal leading-relaxed">
		{desc}
	</li>
	{#if 'properties' in scope}
		<div class="font-fira text-sm">
			{#each Object.entries(scope.properties) as [key, folder]}
				{@const requiredList = 'required' in scope ? scope.required : []}
				<Tree
					{hash}
					{source}
					{key}
					{folder}
					{requiredList}
					{borderColor}
					parent={type}
					expanded={hashExistDeep(hash, `${type}.${key}`)}
				/>
			{/each}
		</div>
	{/if}
</ul>
