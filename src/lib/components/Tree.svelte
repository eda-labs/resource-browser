<script lang="ts">
	import { copy } from 'svelte-copy';

	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import { getDescription, getScope, hashExistDeep, getDefault, getEnum, getFormat, getMinimum, getMaximum } from './functions';
	import type { Schema } from '$lib/structure';

	export let hash: string;
	export let source: string;
	export let key: string;
	export let folder: Schema;
	export let requiredList: string[] = [];
	export let parent: string;
	export let expanded: boolean;
	export let borderColor: string;
	
	// Diff mode props
	export let diffMode: boolean = false;
	export let diffCompareData: Schema | null = null;
	export let diffSide: 'left' | 'right' = 'left';
	export let diffCurrentData: Schema | null = null;

	// reference exported prop so Svelte treats it as used (it's passed from parent/children)
	$: {
		// no-op read to avoid "unused export" diagnostics
		void diffCurrentData;
	}

	let currentId = `${parent}.${key}`;
	let timeout: ReturnType<typeof setTimeout>;
	let defaultVal: string = '';
	let formatVal: string = '';
	let minVal: number | undefined = undefined;
	let maxVal: number | undefined = undefined;

	$: defaultVal = getDefault(folder);
	$: formatVal = getFormat(folder);
	$: minVal = getMinimum(folder);
	$: maxVal = getMaximum(folder);
	
	// Diff helper functions
	function normalizeForComparison(schema: Schema): any {
		if (!schema) return null;
		
		// Only compare the essential properties that matter for diffs
		const normalized: any = {};
		
		if ('type' in schema) normalized.type = schema.type;
		if ('description' in schema) normalized.description = schema.description;
		if ('default' in schema) normalized.default = schema.default;
		if ('enum' in schema) normalized.enum = schema.enum;
		if ('format' in schema) normalized.format = schema.format;
		if ('minimum' in schema) normalized.minimum = schema.minimum;
		if ('maximum' in schema) normalized.maximum = schema.maximum;
		if ('required' in schema) normalized.required = schema.required;
		
		// For objects and arrays, compare structure
		const scope = getScope(schema);
		if ('properties' in scope) {
			normalized.properties = Object.keys(scope.properties).sort();
		}
		if ('items' in scope) {
			normalized.items = normalizeForComparison(scope.items);
		}
		
		return normalized;
	}
	
	function getNestedDiffStatus(): 'added' | 'removed' | 'modified' | 'unchanged' {
		if (!diffMode) return 'unchanged';
		
		// Check if this specific field exists in both versions
		const existsInCompare = diffCompareData !== null && diffCompareData !== undefined;
		const existsHere = folder !== null && folder !== undefined;
		
		// Field added (exists here but not in compare)
		if (existsHere && !existsInCompare) {
			return diffSide === 'left' ? 'removed' : 'added';
		}
		
		// Field removed (doesn't exist here but exists in compare)
		if (!existsHere && existsInCompare) {
			return 'unchanged'; // Don't highlight on this side
		}
		
		// Both exist - check if they're different by comparing normalized versions
		if (existsHere && existsInCompare && diffCompareData) {
			// prefer an explicitly-provided current-side value when available (passed from parent),
			// otherwise fall back to the local folder. This also ensures the exported
			// `diffCurrentData` prop is referenced so it's not treated as unused.
			const currentNormalized = normalizeForComparison(diffCurrentData ?? folder);
			const compareNormalized = normalizeForComparison(diffCompareData);
			
			const currentStr = JSON.stringify(currentNormalized);
			const compareStr = JSON.stringify(compareNormalized);
			
			if (currentStr !== compareStr) {
				return 'modified';
			}
		}
		
		return 'unchanged';
	}
	
	$: nestedDiffStatus = getNestedDiffStatus();
	$: showDiffIndicator = diffMode && nestedDiffStatus !== 'unchanged';

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

<li id={currentId} tabindex="-1" class="scroll-mt-[80px] pt-1 {showDiffIndicator ? (
		nestedDiffStatus === 'added' ? 'bg-green-100/70 dark:bg-green-900/10 border-l-3 border-green-600 dark:border-green-500 pl-2 -ml-2 rounded-md' :
		nestedDiffStatus === 'removed' ? 'bg-red-100/70 dark:bg-red-900/10 border-l-3 border-red-600 dark:border-red-500 pl-2 -ml-2 rounded-md' :
		nestedDiffStatus === 'modified' ? 'bg-amber-100/70 dark:bg-yellow-900/10 border-l-3 border-amber-600 dark:border-yellow-500 pl-2 -ml-2 rounded-md' :
		''
	) : ''} focus:bg-orange-50 dark:focus:bg-orange-900/20 focus:ring-2 focus:ring-orange-400 focus:rounded-md">
	<div class="group flex items-center space-x-2 px-2 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors relative">
		{#if showDiffIndicator}
			<span class="absolute -left-3 top-2 text-xs font-bold {
				nestedDiffStatus === 'added' ? 'text-green-700 dark:text-green-400' :
				nestedDiffStatus === 'removed' ? 'text-red-700 dark:text-red-400' :
				'text-amber-700 dark:text-yellow-400'
			}">
				{nestedDiffStatus === 'added' ? '+' : nestedDiffStatus === 'removed' ? '−' : '~'}
			</span>
		{/if}
		<button
			class="scroll-thin flex cursor-pointer items-center space-x-2.5 overflow-x-auto text-gray-800 dark:text-gray-300"
			on:click={handleLocalExpand}
		>
			<svg
				class="svg-arrow h-3.5 w-3.5 text-gray-600 transition-all duration-200 group-hover:text-blue-600 dark:text-gray-300 dark:group-hover:text-blue-400 {expanded
					? 'rotate-90'
					: ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
			</svg>
			<span
				class="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400 {hash === currentId
					? 'text-green-600 dark:text-green-400'
					: ''}"
				>{key}{#if requiredList.includes(key)}<sup class="text-xs font-bold text-red-500 dark:text-red-400"
						>*</sup
					>{/if}</span
			>
			{#if 'type' in folder}
				{@const typeColors = {
					'string': 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
					'integer': 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
					'number': 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
					'boolean': 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
					'object': 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
					'array': 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800'
				}}
				{@const typeColor = typeColors[folder.type] || 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
				<span class="inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-medium border {typeColor}"
					>{folder.type}</span
				>
			{/if}
		</button>
		{#if source !== 'uploaded'}
				<a
					href={() => '#'}
					class="cursor-pointer text-gray-400 dark:text-gray-500 {expanded
						? 'block'
						: 'hidden'} hover:text-gray-700 md:hidden md:group-hover:block md:group-active:block dark:hover:text-gray-300"
					on:click={(e) => {
						// Prefer using the current page path/search when available (resource view)
						const pathParts = window.location.pathname.split('/').filter(Boolean);
						let resName = '';
						let resVersion = '';
						if (pathParts.length >= 2) {
							resName = pathParts[0];
							resVersion = pathParts[1];
						} else {
							const lastDot = (hash || '').lastIndexOf('.');
							resName = lastDot !== -1 ? (hash || '').substring(0, lastDot) : (hash || '');
							resVersion = lastDot !== -1 ? (hash || '').substring(lastDot + 1) : '';
						}
						const urlSearch = new URLSearchParams(window.location.search);
						const selectedReleaseParam = urlSearch.get('release');
						// Use explicit URL release param if present; otherwise use `source` only when
						// it represents a real release name (avoid fallback `release` string).
						const releaseParam = selectedReleaseParam || (source && source !== 'release' ? source : '');
						const url = `${window.location.origin}/${resName}/${resVersion}${releaseParam ? `?release=${encodeURIComponent(releaseParam)}` : ''}#${currentId}`;
						// open in a new tab/window so search results are not lost
						window.open(url, '_blank');
						e.preventDefault();
					}}
						use:copy={{
						text: (() => {
							const pathParts = window.location.pathname.split('/').filter(Boolean);
							let resName = '';
							let resVersion = '';
							if (pathParts.length >= 2) {
								resName = pathParts[0];
								resVersion = pathParts[1];
							} else {
								const lastDot = (hash || '').lastIndexOf('.');
								resName = lastDot !== -1 ? (hash || '').substring(0, lastDot) : (hash || '');
								resVersion = lastDot !== -1 ? (hash || '').substring(lastDot + 1) : '';
							}
							const urlSearch = new URLSearchParams(window.location.search);
							const selectedReleaseParam = urlSearch.get('release');
							const releaseParam = selectedReleaseParam || (source && source !== 'release' ? source : '');
							return window.location.origin + `/${resName}/${resVersion}${releaseParam ? `?release=${encodeURIComponent(releaseParam)}` : ''}#${currentId}`;
						})(),
						onCopy({ event }: any) {
							const target = event?.target as HTMLElement | null;
							if (target) {
								target.innerHTML = '&check;';
								timeout = setTimeout(() => {
									target.innerHTML = '#';
								}, 500);
							}
						}
					}}>#</a>
		{/if}
	</div>
	{#if expanded}
		<ul class="ml-[9px] border-l-2 px-4 pt-2 pb-1 dark:bg-gray-800/30 {borderColor}">
			<li class="font-nokia px-2 py-1.5 text-sm font-light text-gray-600 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-800/50 rounded-md whitespace-normal">
				{getDescription(folder)}
			</li>
			
			<!-- Metadata Section -->
			<div class="mt-2 space-y-1.5">
					{#if defaultVal}
						<li class="font-fira px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-3 border-amber-500 dark:border-amber-600">
							<span class="font-semibold text-amber-800 dark:text-amber-400">default:</span> 
							<code class="text-orange-900 dark:text-orange-300 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded">{defaultVal}</code>
						</li>
					{/if}
					{#if getEnum(folder)}
						<li class="font-fira px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-3 border-purple-500 dark:border-purple-600">
							<span class="font-semibold text-purple-800 dark:text-purple-400">enum:</span> 
							<code class="text-violet-900 dark:text-violet-300 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded">{getEnum(folder)}</code>
						</li>
					{/if}
					{#if formatVal}
						<li class="font-fira px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-3 border-blue-500 dark:border-blue-600">
							<span class="font-semibold text-blue-800 dark:text-blue-400">format:</span> 
							<code class="text-cyan-900 dark:text-cyan-300 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded">{formatVal}</code>
						</li>
					{/if}
					{#if minVal !== undefined || maxVal !== undefined}
						<li class="font-fira px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-md border-l-3 border-green-500 dark:border-green-600">
							<span class="font-semibold text-green-800 dark:text-green-400">constraints:</span>
							<code class="text-emerald-900 dark:text-emerald-300 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded">
								{#if minVal !== undefined}min: {minVal}{/if}
								{#if minVal !== undefined && maxVal !== undefined}, {/if}
								{#if maxVal !== undefined}max: {maxVal}{/if}
							</code>
						</li>
					{/if}
			</div>
			
			{#if folder.type === 'object' || folder.type === 'array'}
				{@const props = propExist()}
				{#if typeof props === 'object'}
					{#each Object.entries(props) as [subkey, subfolder]}
						{@const scope = getScope(folder)}
						{@const requiredList = 'required' in scope ? scope.required : []}
						{@const subCompareData = diffMode && diffCompareData ? (() => {
							const compareScope = getScope(diffCompareData);
							if ('properties' in compareScope && subkey in compareScope.properties) {
								return compareScope.properties[subkey];
							}
							return null;
						})() : null}
						{@const subCurrentData = diffMode && folder ? subfolder : null}
						<svelte:self
							{hash}
							{source}
							{borderColor}
							key={subkey}
							folder={subfolder}
							{requiredList}
							parent={currentId}
							expanded={hashExistDeep(hash, `${currentId}.${subkey}`)}
							{diffMode}
							diffCompareData={subCompareData}
							diffCurrentData={subCurrentData}
							{diffSide}
						/>
					{/each}
				{/if}
			{/if}
		</ul>
	{/if}
</li>
