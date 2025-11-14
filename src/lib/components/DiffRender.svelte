<script lang="ts">
	import type { Schema } from '$lib/structure';
	import Tree from './Tree.svelte';
	import { getDescription, getScope } from './functions';

	export let hash: string = '';
	export let source: string;
	export let type: string;
	export let leftData: Schema;
	export let rightData: Schema | null = null;
	export let side: 'left' | 'right' = 'left';

	const data = side === 'left' ? leftData : (rightData || leftData);
	const compareData = side === 'left' ? rightData : leftData;

	const desc = getDescription(data);
	const scope = getScope(data);

	const borderColor =
		type === 'status'
			? 'border-green-400 dark:border-green-700'
			: 'border-gray-300 dark:border-gray-600';

	// Helper function to check if a field exists in compare data
	function fieldExists(key: string): boolean {
		if (!compareData) return true;
		const compareScope = getScope(compareData);
		return 'properties' in compareScope && key in compareScope.properties;
	}

	// Helper function to check if a field is different
	function fieldDifferent(key: string): boolean {
		if (!compareData) return false;
		const compareScope = getScope(compareData);
		if (!('properties' in scope) || !('properties' in compareScope)) return false;
		
		const thisField = JSON.stringify(scope.properties[key]);
		const compareField = JSON.stringify(compareScope.properties[key]);
		return thisField !== compareField;
	}

	// Helper to get diff status
	// Note: leftData is always the base version, rightData is the version being compared to
	// In version comparison: left=v1alpha1, right=v1 (v1 is newer)
	// In release comparison: left=older release, right=newer release
	function getDiffStatus(key: string): 'added' | 'removed' | 'modified' | 'unchanged' {
		if (!compareData) return 'unchanged';
		
		const existsHere = 'properties' in scope && key in scope.properties;
		const existsThere = fieldExists(key);

		// If field exists in current view but not in compare view:
		// - LEFT side (older): field removed in newer version (red on left)
		// - RIGHT side (newer): field added in newer version (green on right)
		if (existsHere && !existsThere) return side === 'left' ? 'removed' : 'added';
		
		// If field doesn't exist in current view but exists in compare view: 
		// Don't highlight (it's shown on the other side)
		if (!existsHere && existsThere) return 'unchanged';
		
		// If field exists in both but values differ
		if (existsHere && existsThere && fieldDifferent(key)) return 'modified';
		
		return 'unchanged';
	}
	
	// Helper to check if any descendant has changes
	function hasDescendantChanges(obj: any, compareObj: any): boolean {
		if (!obj || !compareObj) return false;
		
		const objStr = JSON.stringify(obj);
		const compareStr = JSON.stringify(compareObj);
		return objStr !== compareStr;
	}
</script>

<p class="mb-0 py-1 text-sm text-gray-800 dark:text-gray-200">{type.toUpperCase()}</p>
<ul class="ml-2 border-l px-3 dark:bg-gray-800 {borderColor}">
	<li class="px-1 pt-1.5 text-sm font-light text-gray-400 dark:text-gray-500 whitespace-normal leading-relaxed">
		{desc}
	</li>
	{#if 'properties' in scope}
		<div class="font-fira text-[12.5px]">
			{#each Object.entries(scope.properties) as [key, folder]}
				{@const requiredList = 'required' in scope ? scope.required : []}
				{@const diffStatus = getDiffStatus(key)}
				{@const bgClass = 
					diffStatus === 'added' ? 'bg-green-100 dark:bg-green-900/20 border-l-3 border-green-600 dark:border-green-500' :
					diffStatus === 'removed' ? 'bg-red-100 dark:bg-red-900/20 border-l-3 border-red-600 dark:border-red-500' :
					diffStatus === 'modified' ? 'bg-amber-100 dark:bg-yellow-900/20 border-l-3 border-amber-600 dark:border-yellow-500' :
					''
				}
				{@const fieldCompareData = compareData ? (() => {
					const compareScope = getScope(compareData);
					if ('properties' in compareScope && key in compareScope.properties) {
						return compareScope.properties[key];
					}
					return null;
				})() : null}
				<div class="relative {bgClass} {bgClass ? 'pl-2 -ml-2 my-1 rounded-md' : ''}">
					{#if diffStatus !== 'unchanged'}
						<span class="absolute -left-1 top-1 text-xs font-bold {
							diffStatus === 'added' ? 'text-green-700 dark:text-green-400' :
							diffStatus === 'removed' ? 'text-red-700 dark:text-red-400' :
							'text-amber-700 dark:text-yellow-400'
						}">
							{diffStatus === 'added' ? '+' : diffStatus === 'removed' ? '−' : '~'}
						</span>
					{/if}
					<Tree
						{hash}
						{source}
						{key}
						{folder}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={false}
						diffMode={!!compareData}
						diffCompareData={fieldCompareData}
						diffSide={side}
						diffCurrentData={scope.properties[key]}
					/>
				</div>
			{/each}
		</div>
	{/if}
</ul>
