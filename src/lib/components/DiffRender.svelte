<script lang="ts">
	import type { Schema } from '$lib/structure';
	import Tree from './Tree.svelte';
	import {
		getDescription,
		getScope,
		getDefault,
		getFormat,
		getMinimum,
		getMaximum,
		getEnum
	} from './functions';
	import EnumDisplay from './EnumDisplay.svelte';

	export let hash: string = '';
	export let source: string;
	export let type: string;
	export let leftData: Schema;
	export let rightData: Schema | null = null;
	export let side: 'left' | 'right' = 'left';

	const data = side === 'left' ? leftData : rightData || leftData;
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
	// Treat the case where one side exists and the other doesn't as a change
	function hasDescendantChanges(obj: any, compareObj: any): boolean {
		if (!obj && !compareObj) return false;
		if (!obj || !compareObj) return true; // one side missing -> changed

		const objStr = JSON.stringify(obj);
		const compareStr = JSON.stringify(compareObj);
		return objStr !== compareStr;
	}

	// Helper to determine if a schema is an "object" (has properties)
	function isObjectSchema(sch: any): boolean {
		if (!sch) return false;
		try {
			const sc = getScope(sch);
			return 'properties' in sc;
		} catch (e) {
			return false;
		}
	}

	// Prepare compare scope and combined keys so both sides render the same order
	const compareScope = compareData ? getScope(compareData) : null;

	// When comparing versions, prefer the newer (right) scope order as canonical so both
	// left and right render the same sequence. If `rightData` is present, use its
	// ordering; otherwise fall back to the current scope.
	const canonicalScope = rightData ? getScope(rightData) : scope;

	function getCombinedKeys(): string[] {
		const baseKeys =
			canonicalScope && 'properties' in canonicalScope
				? Object.keys(canonicalScope.properties)
				: 'properties' in scope
					? Object.keys(scope.properties)
					: [];
		const otherScope = canonicalScope === scope ? compareScope : scope;
		const otherKeys =
			otherScope && 'properties' in otherScope ? Object.keys(otherScope.properties) : [];

		const combined: string[] = [...baseKeys];
		for (const k of otherKeys) {
			if (!combined.includes(k)) combined.push(k);
		}
		return combined;
	}
</script>

<p class="mb-0 py-1 text-sm text-gray-900 dark:text-gray-200">{type.toUpperCase()}</p>
<ul class="ml-2 border-l px-3 dark:bg-gray-800 {borderColor}">
	<li
		class="px-1 pt-1.5 text-sm leading-relaxed font-light whitespace-normal text-gray-600 dark:text-gray-300"
	>
		{desc}
	</li>
	{#if 'properties' in scope || (compareScope && 'properties' in compareScope)}
		{#each getCombinedKeys() as key}
			{@const requiredList = 'required' in scope ? scope.required : []}
			{@const existsHere = 'properties' in scope && key in scope.properties}
			{@const folder = existsHere ? (scope as any).properties[key] : null}
			{@const diffStatus = getDiffStatus(key)}
			{@const bgClass =
				diffStatus === 'added'
					? 'bg-green-100 dark:bg-green-900/20 border-l-3 border-green-600 dark:border-green-500'
					: diffStatus === 'removed'
						? 'bg-red-100 dark:bg-red-900/20 border-l-3 border-red-600 dark:border-red-500'
						: diffStatus === 'modified'
							? 'bg-amber-100 dark:bg-yellow-900/20 border-l-3 border-amber-600 dark:border-yellow-500'
							: ''}
			{@const fieldCompareData =
				compareScope && 'properties' in compareScope && key in compareScope.properties
					? compareScope.properties[key]
					: null}
			{@const localField = 'properties' in scope ? ((scope as any).properties[key] ?? null) : null}
			<li class="relative {bgClass} {bgClass ? 'my-1 rounded-md' : ''}">
				{#if existsHere}
					{#if diffStatus !== 'unchanged' && !isObjectSchema(folder)}
						<!-- spacer for added/removed/modified primitive field to match object spacing -->
						<div class="h-1"></div>
					{/if}
					{#if diffStatus !== 'unchanged' && !isObjectSchema(folder)}
						<!-- Inline metadata for primitive fields (so added primitives show their details without expanding) -->
						<div class="mt-1 space-y-1.5 pl-8">
							<!-- default / placeholder -->
							{#if folder && getDefault(folder)}
								<div
									class="font-fira rounded-md border-l-3 border-amber-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-amber-600 dark:bg-gray-800/50"
								>
									<span class="font-semibold text-amber-800 dark:text-amber-400">default:</span>
									<code
										class="rounded bg-white/50 px-1.5 py-0.5 text-orange-900 dark:bg-black/20 dark:text-orange-300"
										>{getDefault(folder)}</code
									>
								</div>
							{:else if fieldCompareData && getDefault(fieldCompareData)}
								<div
									class="font-fira rounded-md border-l-3 border-amber-500 px-3 py-1.5 text-xs dark:border-amber-600"
								>
									<span class="font-semibold text-amber-800 dark:text-amber-400">default:</span>
									<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
								</div>
							{/if}

							<!-- enum / placeholder -->
							{#if folder && getEnum(folder)}
								<div
									class="font-fira flex items-center space-x-2 rounded-md border-l-3 border-purple-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-purple-600 dark:bg-gray-800/50"
								>
									<span class="font-semibold text-purple-800 dark:text-purple-400">enum:</span>
									<div class="flex-1">
										<EnumDisplay text={getEnum(folder)} />
									</div>
								</div>
							{:else if fieldCompareData && getEnum(fieldCompareData)}
								<div
									class="font-fira rounded-md border-l-3 border-purple-500 px-3 py-1.5 text-xs dark:border-purple-600"
								>
									<span class="font-semibold text-purple-800 dark:text-purple-400">enum:</span>
									<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
								</div>
							{/if}

							<!-- format / placeholder -->
							{#if folder && getFormat(folder)}
								<div
									class="font-fira rounded-md border-l-3 border-blue-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-blue-600 dark:bg-gray-800/50"
								>
									<span class="font-semibold text-blue-800 dark:text-blue-400">format:</span>
									<code
										class="rounded bg-white/50 px-1.5 py-0.5 text-cyan-900 dark:bg-black/20 dark:text-cyan-300"
										>{getFormat(folder)}</code
									>
								</div>
							{:else if fieldCompareData && getFormat(fieldCompareData)}
								<div
									class="font-fira rounded-md border-l-3 border-blue-500 px-3 py-1.5 text-xs dark:border-blue-600"
								>
									<span class="font-semibold text-blue-800 dark:text-blue-400">format:</span>
									<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
								</div>
							{/if}

							<!-- constraints / placeholder -->
							{#if folder && (getMinimum(folder) !== undefined || getMaximum(folder) !== undefined)}
								<div
									class="font-fira rounded-md border-l-3 border-green-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-green-600 dark:bg-gray-800/50"
								>
									<span class="font-semibold text-green-800 dark:text-green-400">constraints:</span>
									<code
										class="rounded bg-white/50 px-1.5 py-0.5 text-emerald-900 dark:bg-black/20 dark:text-emerald-300"
									>
										{#if folder && getMinimum(folder) !== undefined}min: {getMinimum(folder)}{/if}
										{#if folder && getMinimum(folder) !== undefined && getMaximum(folder) !== undefined},
										{/if}
										{#if folder && getMaximum(folder) !== undefined}max: {getMaximum(folder)}{/if}
									</code>
								</div>
							{:else if fieldCompareData && (getMinimum(fieldCompareData) !== undefined || getMaximum(fieldCompareData) !== undefined)}
								<div
									class="font-fira rounded-md border-l-3 border-green-500 px-3 py-1.5 text-xs dark:border-green-600"
								>
									<span class="font-semibold text-green-800 dark:text-green-400">constraints:</span>
									<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
								</div>
							{/if}
						</div>
					{/if}
					<Tree
						{hash}
						{source}
						{key}
						folder={folder as Schema}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={diffStatus !== 'unchanged' || hasDescendantChanges(folder, fieldCompareData)}
						diffMode={!!compareData}
						diffCompareData={fieldCompareData}
						diffSide={side}
						diffCurrentData={existsHere ? (scope as any).properties[key] : null}
					/>
				{:else}
					{#if fieldCompareData}
						{#if !isObjectSchema(fieldCompareData)}
							<div class="mt-1 space-y-1.5 pl-8">
								{#if getDefault(fieldCompareData)}
									<div
										class="font-fira rounded-md border-l-3 border-amber-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-amber-600 dark:bg-gray-800/50"
									>
										<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
									</div>
								{/if}
								{#if getEnum(fieldCompareData)}
									<div
										class="font-fira rounded-md border-l-3 border-purple-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-purple-600 dark:bg-gray-800/50"
									>
										<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
									</div>
								{/if}
								{#if getFormat(fieldCompareData)}
									<div
										class="font-fira rounded-md border-l-3 border-blue-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-blue-600 dark:bg-gray-800/50"
									>
										<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
									</div>
								{/if}
								{#if getMinimum(fieldCompareData) !== undefined || getMaximum(fieldCompareData) !== undefined}
									<div
										class="font-fira rounded-md border-l-3 border-green-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-green-600 dark:bg-gray-800/50"
									>
										<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
									</div>
								{/if}
							</div>
						{/if}
						{#if getEnum(fieldCompareData)}
							<div
								class="font-fira flex items-center space-x-2 rounded-md border-l-3 border-purple-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-purple-600 dark:bg-gray-800/50"
							>
								<span class="font-semibold text-purple-800 dark:text-purple-400">enum:</span>
								<div class="flex-1">
									<EnumDisplay text={getEnum(fieldCompareData)} />
								</div>
							</div>
						{/if}
						{#if getFormat(fieldCompareData)}
							<div
								class="font-fira rounded-md border-l-3 border-blue-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-blue-600 dark:bg-gray-800/50"
							>
								<span class="font-semibold text-blue-800 dark:text-blue-400">format:</span>
								<code
									class="rounded bg-white/50 px-1.5 py-0.5 text-cyan-900 dark:bg-black/20 dark:text-cyan-300"
									>{getFormat(fieldCompareData)}</code
								>
							</div>
						{/if}
						{#if getMinimum(fieldCompareData) !== undefined || getMaximum(fieldCompareData) !== undefined}
							<div
								class="font-fira rounded-md border-l-3 border-green-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-green-600 dark:bg-gray-800/50"
							>
								<span class="font-semibold text-green-800 dark:text-green-400">constraints:</span>
								<code
									class="rounded bg-white/50 px-1.5 py-0.5 text-emerald-900 dark:bg-black/20 dark:text-emerald-300"
								>
									{#if getMinimum(fieldCompareData) !== undefined}min: {getMinimum(
											fieldCompareData
										)}{/if}
									{#if getMinimum(fieldCompareData) !== undefined && getMaximum(fieldCompareData) !== undefined},
									{/if}
									{#if getMaximum(fieldCompareData) !== undefined}max: {getMaximum(
											fieldCompareData
										)}{/if}
								</code>
							</div>
						{/if}
					{/if}
					<!-- Render a ghost Tree using the compare-side schema so spacing matches visually -->
					<Tree
						{hash}
						{source}
						{key}
						folder={fieldCompareData as Schema}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={diffStatus !== 'unchanged' ||
							hasDescendantChanges(fieldCompareData, localField)}
						diffMode={!!compareData}
						diffCompareData={null}
						diffSide={side}
						diffCurrentData={null}
						ghost={true}
					/>
				{/if}
			</li>
		{/each}
	{/if}
</ul>
