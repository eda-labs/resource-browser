<script lang="ts">
	import { copy } from 'svelte-copy';

	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import { getDescription, getScope, hashExistDeep, getDefault } from './functions';
	import type { Schema } from '$lib/structure';

	export let hash: string;
	export let source: string;
	export let key: string;
	export let folder: Schema;
	export let requiredList: string[] = [];
	export let parent: string;
	export let expanded: boolean;
	export let borderColor: string;

	let currentId = `${parent}.${key}`;
	let timeout: ReturnType<typeof setTimeout>;
	let defaultVal: string = '';

	$: defaultVal = getDefault(folder);

	function handleLocalExpand() {
		expanded = !expanded;
		expandAllScope.set('local');
	}

	function propExist() {
		const scope = getScope(folder) as any;
		if (!('properties' in scope)) {
			scope['properties'] = getDescription(scope);
		}
		return scope.properties;
	}

	function updateHash(newHash: string) {
		location.hash = newHash;
		window.location.reload();
	}

	$: {
		if ($expandAllScope === 'global') {
			expanded = $expandAll;
			expandAllScope.set('global');
		}
	}

	$: {
		if (expanded) {
			ulExpanded.update((arr) => [...arr, currentId]);
		} else {
			ulExpanded.update((arr) => arr.filter((x) => x.indexOf(currentId) === -1));
		}
	}
</script>

<li id={currentId} class="scroll-mt-[80px] pt-1">
	<div class="group flex items-center space-x-2 px-1 pt-2">
		<button
			class="scroll-thin flex cursor-pointer items-center space-x-2 overflow-x-auto text-gray-800 dark:text-gray-200"
			on:click={handleLocalExpand}
		>
			<svg
				class="svg-arrow h-3 w-3 text-gray-800 transition-transform duration-200 group-hover:text-gray-400 dark:text-gray-200 {expanded
					? 'rotate-90'
					: ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
			</svg>
			<span
				class="group-hover:text-blue-500 {hash === currentId
					? 'text-green-600 dark:text-green-500'
					: ''}"
				>{key}{#if requiredList.includes(key)}<sup class="text-xs text-red-400 dark:text-red-500"
						>*</sup
					>{/if}</span
			>
			{#if 'type' in folder}
				<span class="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] dark:bg-gray-700"
					>{folder.type}</span
				>
			{/if}
		</button>
		{#if source !== 'uploaded'}
			<a
				href={`#${currentId}`}
				class="cursor-pointer text-gray-400 dark:text-gray-500 {expanded
					? 'block'
					: 'hidden'} hover:text-gray-700 md:hidden md:group-hover:block md:group-active:block dark:hover:text-gray-300"
				use:copy={{
					text: window.location.origin + window.location.pathname + `#${currentId}`,
					onCopy({ event }: any) {
						const target = event?.target as HTMLElement | null;
						if (target) {
							target.innerHTML = '&check;';
							timeout = setTimeout(() => {
								target.innerHTML = '#';
							}, 500);
						}
					}
				}}>#</a
			>
		{/if}
	</div>
	{#if expanded}
		<ul class="ml-[9px] border-l px-3 pt-2 dark:bg-gray-800 {borderColor}">
			<li class="font-nokia px-1 text-sm font-light text-gray-400 dark:text-gray-500">
				{getDescription(folder)}
			</li>
			{#if defaultVal}
				<li>
					<span class="font-nokia px-1 text-sm text-gray-400 opacity-60 dark:text-gray-500"
						>[default: {defaultVal}]</span
					>
				</li>
			{/if}
			{#if folder.type === 'object' || folder.type === 'array'}
				{@const props = propExist()}
				{#if typeof props === 'object'}
					{#each Object.entries(props) as [subkey, subfolder]}
						{@const scope = getScope(folder)}
						{@const requiredList = 'required' in scope ? scope.required : []}
						<svelte:self
							{hash}
							{source}
							{borderColor}
							key={subkey}
							folder={subfolder}
							{requiredList}
							parent={currentId}
							expanded={hashExistDeep(hash, `${currentId}.${subkey}`)}
						/>
					{/each}
				{/if}
			{/if}
		</ul>
	{/if}
</li>
