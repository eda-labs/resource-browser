<script lang="ts">
	import { copy } from 'svelte-copy';

	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';
	import {
		getDescription,
		getScope,
		hashExistDeep,
		getDefault,
		getEnum,
		getFormat,
		getMinimum,
		getMaximum,
		getMinItems,
		getMaxItems
	} from './functions';
	import EnumDisplay from './EnumDisplay.svelte';
	import type { Schema } from '$lib/structure';

	import { onMount } from 'svelte';

	export let hash: string;
	export let source: string;
	export let key: string;
	export let folder: Schema;
	export let requiredList: string[] = [];
	export let parent: string;
	export let expanded: boolean;
	export let borderColor: string;
	export let compact: boolean = false;
	export let onResourcePage: boolean = false;
	$: desc = getDescription(folder);
	$: compactRowPadding = compact ? 'px-1 py-0.5' : 'px-2 py-2';

	// Portal action for tooltip (mount tooltip nodes to document.body)
	function portal(node: HTMLElement) {
		if (typeof document === 'undefined') return { destroy() {} };
		const target = document.body;
		target.appendChild(node);
		return {
			destroy() {
				try {
					if (node.parentNode) node.parentNode.removeChild(node);
				} catch (e) {
					/* ignore */
				}
			}
		};
	}

	let showTooltip = false;
	let tooltipStyle = '';
	let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
	let lastTooltipTarget: HTMLElement | null = null;
	let rafId: number | null = null;

	function showTooltipAt(el: HTMLElement) {
		try {
			// Only compute the rect if the target changed or tooltip is not shown yet
			if (lastTooltipTarget !== el || !showTooltip) {
				lastTooltipTarget = el;
				const rect = el.getBoundingClientRect();
				const scrollX = window.scrollX || window.pageXOffset || 0;
				const scrollY = window.scrollY || window.pageYOffset || 0;
				// estimate our preferred tooltip width
				const estWidth = Math.min(window.innerWidth * 0.5, 420);
				const rightSpace = window.innerWidth - rect.right;
				const leftSpace = rect.left;
				const bottomSpace = window.innerHeight - rect.bottom;
				const topSpace = rect.top;

				let left: number;
				let top: number;
				let transform = '';

				// Prefer to place tooltip to the right if there's enough room
				if (rightSpace > estWidth + 32) {
					left = rect.right + 8 + scrollX;
					top = rect.top + rect.height / 2 + scrollY;
					transform = 'translateY(-50%)';
				} else if (bottomSpace > 120) {
					// place centered below element
					left = rect.left + rect.width / 2 + scrollX;
					top = rect.bottom + 8 + scrollY;
					transform = 'translateX(-50%)';
				} else if (topSpace > 120) {
					// place centered above element
					left = rect.left + rect.width / 2 + scrollX;
					top = rect.top - 8 + scrollY;
					transform = 'translateX(-50%) translateY(-100%)';
				} else {
					// fallback centered below
					left = rect.left + rect.width / 2 + scrollX;
					top = rect.bottom + 8 + scrollY;
					transform = 'translateX(-50%)';
				}

				// Schedule the DOM update on the next animation frame to avoid forcing layout
				if (rafId) cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => {
					tooltipStyle = `position:absolute; left:${left}px; top:${top}px; transform: ${transform}; z-index:2147483650;`;
					showTooltip = true;
					rafId = null;
				});
			}
		} catch (e) {
			showTooltip = false;
		}
	}

	function hideTooltipSoon() {
		if (tooltipTimer) clearTimeout(tooltipTimer);
		tooltipTimer = setTimeout(() => {
			showTooltip = false;
			tooltipTimer = null;
		}, 100);
	}

	function parseResourceFromHash(h: string) {
		// Remove trailing .spec or .status if present
		let hh = String(h || '');
		hh = hh.replace(/\.spec$|\.status$/, '');
		const idx = hh.lastIndexOf('.');
		if (idx === -1) return { resName: hh, resVersion: '' };
		const resName = hh.substring(0, idx);
		const resVersion = hh.substring(idx + 1);
		return { resName, resVersion };
	}

	// Diff mode props
	export let diffMode: boolean = false;
	export let diffCompareData: Schema | null = null;
	export let diffSide: 'left' | 'right' = 'left';
	export let diffCurrentData: Schema | null = null;
	// When true, render the node as a ghost: invisible but keeps layout space
	export let ghost: boolean = false;

	// reference exported prop so Svelte treats it as used (it's passed from parent/children)
	$: {
		// no-op read to avoid "unused export" diagnostics
		void diffCurrentData;
	}

	let currentId = `${parent}.${key}`;
	let timeout: ReturnType<typeof setTimeout>;
	let copiedPath: string | null = null;
	let defaultVal: string = '';
	let formatVal: string = '';
	let minVal: number | undefined = undefined;
	let maxVal: number | undefined = undefined;
	let minItemsVal: number | undefined = undefined;
	let maxItemsVal: number | undefined = undefined;

	$: defaultVal = getDefault(folder);
	$: formatVal = getFormat(folder);
	$: minVal = getMinimum(folder);
	$: maxVal = getMaximum(folder);
	$: minItemsVal = getMinItems(folder);
	$: maxItemsVal = getMaxItems(folder);

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
		if ('minItems' in schema) normalized.minItems = schema.minItems;
		if ('maxItems' in schema) normalized.maxItems = schema.maxItems;
		if ('required' in schema) normalized.required = schema.required;

		// For objects and arrays, compare structure (including nested structure)
		const scope = getScope(schema);
		if ('properties' in scope) {
			normalized.properties = {};
			for (const [pname, pschema] of Object.entries(scope.properties || {})) {
				normalized.properties[pname] = normalizeForComparison(pschema as Schema);
			}
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

	// Helper to detect nested changes by comparing normalized representations
	function hasNestedChanges(a: Schema | null, b: Schema | null): boolean {
		const na = normalizeForComparison(a as Schema);
		const nb = normalizeForComparison(b as Schema);
		try {
			return JSON.stringify(na) !== JSON.stringify(nb);
		} catch (e) {
			return false;
		}
	}

	let _initExpanded = false;
	// Initialize expanded state once so users can still toggle it later
	$: if (!_initExpanded) {
		// If in diff mode and this node or any descendant differs, expand by default
		if (diffMode && hasNestedChanges(diffCurrentData ?? folder, diffCompareData)) {
			expanded = true;
		}
		_initExpanded = true;
	}

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

<li
	id={currentId}
	tabindex="-1"
	class="relative z-0 scroll-mt-[80px] pt-1 {showDiffIndicator
		? nestedDiffStatus === 'added'
			? 'rounded-md border-l-3 border-green-600 bg-green-100/70 dark:border-green-500 dark:bg-green-900/10'
			: nestedDiffStatus === 'removed'
				? 'rounded-md border-l-3 border-red-600 bg-red-100/70 dark:border-red-500 dark:bg-red-900/10'
				: nestedDiffStatus === 'modified'
					? 'rounded-md border-l-3 border-amber-600 bg-amber-100/70 dark:border-yellow-500 dark:bg-yellow-900/10'
					: ''
		: ''}{ghost
		? ' pointer-events-none opacity-0 select-none'
		: ''} focus:rounded-md focus:bg-orange-50 focus:ring-2 focus:ring-orange-400 dark:focus:bg-orange-900/20"
>
	<div
		class="group relative flex items-center space-x-2 {compactRowPadding} rounded-md transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
	>
		{#if showDiffIndicator}
			<!-- Diff indicator glyph removed; color/highlight retained -->
		{/if}
		<button
			class="scroll-thin flex cursor-pointer items-center space-x-2.5 overflow-x-auto text-gray-800 dark:text-gray-300"
			on:click={handleLocalExpand}
			on:mouseenter={(e) => {
				if (compact && desc) showTooltipAt(e.currentTarget as HTMLElement);
			}}
			on:mouseleave={() => {
				if (compact && desc) hideTooltipSoon();
			}}
			on:focusin={(e) => {
				if (compact && desc) showTooltipAt(e.currentTarget as HTMLElement);
			}}
			on:focusout={() => {
				if (compact) hideTooltipSoon();
			}}
			aria-describedby={compact ? `${currentId}-tooltip` : undefined}
		>
			<svg
				class="svg-arrow h-3 w-3 text-gray-600 transition-all duration-200 group-hover:text-cyan-700 dark:text-gray-300 dark:group-hover:text-cyan-400 {expanded
					? 'rotate-90'
					: ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
			</svg>
			<span
				class="font-medium {compact
					? 'text-sm'
					: ''} text-gray-900 transition-colors group-hover:text-cyan-700 dark:text-gray-100 dark:group-hover:text-cyan-400 {hash ===
				currentId
					? 'text-cyan-700 dark:text-cyan-400'
					: ''}"
				>{key}{#if requiredList.includes(key)}<sup
						class="text-xs font-bold text-red-500 dark:text-red-400">*</sup
					>{/if}</span
			>
			{#if 'type' in folder}
				{@const typeColors = {
					string:
						'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
					integer:
						'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
					number:
						'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
					boolean:
						'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
					object:
						'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
					array:
						'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800'
				}}
				{@const typeColor =
					typeColors[folder.type] ||
					'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-800'}
				<span
					class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium {typeColor} {compact
						? 'px-1 text-[9px]'
						: ''}">{folder.type}</span
				>
			{/if}
			<!-- removed group-hover tooltip; replaced by portal tooltip below -->
		</button>
		{#if compact && showTooltip}
			<div
				use:portal
				id={`${currentId}-tooltip`}
				role="tooltip"
				class="absolute z-[2147483650] inline-block max-w-[80%] rounded-md bg-slate-800 px-3 py-2 text-sm leading-tight whitespace-normal text-white shadow-lg"
				style={tooltipStyle}
				on:mouseenter={() => {
					if (tooltipTimer) clearTimeout(tooltipTimer);
				}}
				on:mouseleave={() => hideTooltipSoon()}
			>
				{getDescription(folder)}
			</div>
		{/if}
		{#if source !== 'uploaded'}
			<button
				type="button"
				class="cursor-pointer text-cyan-600 dark:text-cyan-400 {expanded
					? 'block'
					: 'hidden'} hover:text-cyan-700 md:hidden md:group-hover:block md:group-active:block dark:hover:text-cyan-300"
				on:click|capture={(e) => {
					// Prefer using the current page path/search when available (resource view)
					const pathParts = window.location.pathname.split('/').filter(Boolean);
					let resName = '';
					let resVersion = '';
					if (pathParts.length >= 2) {
						resName = pathParts[0];
						resVersion = pathParts[1];
					} else {
						const lastDot = (hash || '').lastIndexOf('.');
						resName = lastDot !== -1 ? (hash || '').substring(0, lastDot) : hash || '';
						resVersion = lastDot !== -1 ? (hash || '').substring(lastDot + 1) : '';
					}
					const urlSearch = new URLSearchParams(window.location.search);
					const selectedReleaseParam = urlSearch.get('release');
					// Use explicit URL release param if present; otherwise use `source` only when
					// it represents a real release name (avoid fallback `release` string).
					const releaseParam =
						selectedReleaseParam || (source && source !== 'release' ? source : '');
					const url = `${window.location.origin}/${resName}/${resVersion}${releaseParam ? `?release=${encodeURIComponent(releaseParam)}` : ''}#${currentId}`;
					// Determine whether we are already on the resource page for this resource.
					// If so, just update the hash to highlight and scroll to this field rather than opening a new page.
					const isOnResourcePage =
						onResourcePage &&
						pathParts.length >= 2 &&
						pathParts[0] === resName &&
						(!resVersion || pathParts[1] === resVersion);
					// Construct the URL using parsed resName/resVersion from `hash` if possible
					// Prefer the pathname-resolved resource name/version when on a resource page
					let resourcePath = resName || '';
					let verPath = resVersion ? `/${resVersion}` : '';
					if (pathParts.length < 2) {
						const { resName: parsedResName, resVersion: parsedResVersion } = parseResourceFromHash(
							hash || ''
						);
						if (parsedResName) resourcePath = parsedResName;
						if (parsedResVersion) verPath = `/${parsedResVersion}`;
					}
					const base = window.location.origin;
					const fullUrl = `${base}/${resourcePath}${verPath}${releaseParam ? `?release=${encodeURIComponent(releaseParam)}` : ''}#${currentId}`;
					if (isOnResourcePage) {
						// Navigate to the element hash in-place without opening a new page
						const newUrl = `${window.location.pathname}${window.location.search}#${currentId}`;
						history.pushState(null, '', newUrl);
						const el = document.getElementById(currentId);
						if (el && typeof el.scrollIntoView === 'function') {
							el.scrollIntoView({ behavior: 'smooth', block: 'center' });
							// Optionally focus the element for accessibility
							try {
								(el as HTMLElement).focus();
							} catch (e) {
								/* ignore */
							}
							// Add temporary highlight to make the selected field visually distinct AND copy link
							try {
								el.classList.add('bg-amber-100', 'dark:bg-amber-900/10');
								// set copy indication
								copiedPath = currentId;
								if (timeout) clearTimeout(timeout);
								timeout = setTimeout(() => {
									if (copiedPath === currentId) copiedPath = null;
								}, 500);
								try {
									navigator.clipboard.writeText(fullUrl);
								} catch (e) {
									/* ignore */
								}
								setTimeout(() => {
									el.classList.remove('bg-amber-100', 'dark:bg-amber-900/10');
								}, 1800);
							} catch (e) {
								/* ignore */
							}
						}
					} else {
						// Prefetch the resource YAML to warm the HTTP cache and reduce the two-step blank loading,
						// but don't block the UI for too long — try fetch and open immediately.
						try {
							fetch(fullUrl, { mode: 'same-origin', cache: 'reload' });
						} catch (e) {
							/* ignore */
						}
						window.open(fullUrl, '_blank');
					}
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
							resName = lastDot !== -1 ? (hash || '').substring(0, lastDot) : hash || '';
							resVersion = lastDot !== -1 ? (hash || '').substring(lastDot + 1) : '';
						}
						const urlSearch = new URLSearchParams(window.location.search);
						const selectedReleaseParam = urlSearch.get('release');
						const releaseParam =
							selectedReleaseParam || (source && source !== 'release' ? source : '');
						return (
							window.location.origin +
							`/${resName}/${resVersion}${releaseParam ? `?release=${encodeURIComponent(releaseParam)}` : ''}#${currentId}`
						);
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
				}}>#</button
			>
		{/if}
	</div>
	{#if expanded}
		<ul class="ml-[8px] border-l-2 px-2 pt-1 pb-1 dark:bg-gray-800/30 {borderColor}">
			{#if !compact}
				<li
					class="font-nokia rounded-md bg-gray-50 px-1 py-1 text-xs leading-tight font-light whitespace-normal text-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
				>
					{getDescription(folder)}
				</li>
			{/if}

			<!-- Metadata Section -->
			{#if defaultVal}
				<li
					class="font-fira rounded-md border-l-3 border-amber-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-amber-600 dark:bg-gray-800/50"
				>
					<span class="font-semibold text-amber-800 dark:text-amber-400">default:</span>
					<code
						class="rounded bg-white/50 px-1.5 py-0.5 text-orange-900 dark:bg-black/20 dark:text-orange-300"
						>{defaultVal}</code
					>
				</li>
			{:else if diffMode && diffCompareData && getDefault(diffCompareData)}
				<li
					class="font-fira rounded-md border-l-3 border-amber-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-amber-600 dark:bg-gray-800/50"
				>
					<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
				</li>
			{/if}
			{#if getEnum(folder)}
				<li
					class="font-fira flex items-center space-x-2 rounded-md border-l-3 border-purple-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-purple-600 dark:bg-gray-800/50"
				>
					<span class="font-semibold text-purple-800 dark:text-purple-400">enum:</span>
					<div class="flex-1">
						<EnumDisplay text={getEnum(folder)} />
					</div>
				</li>
			{:else if diffMode && diffCompareData && getEnum(diffCompareData)}
				<li
					class="font-fira rounded-md border-l-3 border-purple-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-purple-600 dark:bg-gray-800/50"
				>
					<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
				</li>
			{/if}
			{#if formatVal}
				<li
					class="font-fira rounded-md border-l-3 border-blue-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-blue-600 dark:bg-gray-800/50"
				>
					<span class="font-semibold text-blue-800 dark:text-blue-400">format:</span>
					<code
						class="rounded bg-white/50 px-1.5 py-0.5 text-cyan-900 dark:bg-black/20 dark:text-cyan-300"
						>{formatVal}</code
					>
				</li>
			{:else if diffMode && diffCompareData && getFormat(diffCompareData)}
				<li
					class="font-fira rounded-md border-l-3 border-blue-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-blue-600 dark:bg-gray-800/50"
				>
					<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
				</li>
			{/if}
			{#if minVal !== undefined || maxVal !== undefined}
				<li
					class="font-fira rounded-md border-l-3 border-green-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-green-600 dark:bg-gray-800/50"
				>
					<span class="font-semibold text-green-800 dark:text-green-400">constraints:</span>
					<code
						class="rounded bg-white/50 px-1.5 py-0.5 text-emerald-900 dark:bg-black/20 dark:text-emerald-300"
					>
						{#if minVal !== undefined}min: {minVal}{/if}
						{#if minVal !== undefined && maxVal !== undefined},
						{/if}
						{#if maxVal !== undefined}max: {maxVal}{/if}
					</code>
				</li>
			{:else if diffMode && diffCompareData && (getMinimum(diffCompareData) !== undefined || getMaximum(diffCompareData) !== undefined)}
				<li
					class="font-fira rounded-md border-l-3 border-green-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-green-600 dark:bg-gray-800/50"
				>
					<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
				</li>
			{/if}
			{#if minItemsVal !== undefined || maxItemsVal !== undefined}
				<li
					class="font-fira rounded-md border-l-3 border-indigo-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-indigo-600 dark:bg-gray-800/50"
				>
					<span class="font-semibold text-indigo-800 dark:text-indigo-400">array size:</span>
					<code
						class="rounded bg-white/50 px-1.5 py-0.5 text-indigo-900 dark:bg-black/20 dark:text-indigo-300"
					>
						{#if minItemsVal !== undefined}minItems: {minItemsVal}{/if}
						{#if minItemsVal !== undefined && maxItemsVal !== undefined},
						{/if}
						{#if maxItemsVal !== undefined}maxItems: {maxItemsVal}{/if}
					</code>
				</li>
			{:else if diffMode && diffCompareData && (getMinItems(diffCompareData) !== undefined || getMaxItems(diffCompareData) !== undefined)}
				<li
					class="font-fira rounded-md border-l-3 border-indigo-500 bg-gray-50 px-3 py-1.5 text-xs dark:border-indigo-600 dark:bg-gray-800/50"
				>
					<code class="rounded px-1.5 py-0.5 text-transparent">&nbsp;</code>
				</li>
			{/if}

			{#if folder.type === 'object' || folder.type === 'array'}
				{@const props = propExist()}
				{#if typeof props === 'object'}
					{@const thisScope = getScope(folder)}
					{@const localCompareScope =
						diffMode && diffCompareData ? getScope(diffCompareData) : null}
					{@const canonical =
						diffMode && diffSide === 'left' && localCompareScope ? localCompareScope : thisScope}
					{@const baseKeys =
						canonical && 'properties' in canonical
							? Object.keys((canonical as any).properties)
							: 'properties' in thisScope
								? Object.keys((thisScope as any).properties)
								: []}
					{@const otherScope = canonical === thisScope ? localCompareScope : thisScope}
					{@const otherKeys =
						otherScope && 'properties' in otherScope ? Object.keys(otherScope.properties) : []}
					{@const combinedKeys = (() => {
						const arr: string[] = [...baseKeys];
						for (const k of otherKeys) if (!arr.includes(k)) arr.push(k);
						return arr;
					})()}
					{#each combinedKeys as subkey}
						{@const requiredList = 'required' in thisScope ? thisScope.required : []}
						{@const existsHere =
							'properties' in thisScope && subkey in (thisScope.properties || {})}
						{@const subfolder = existsHere ? thisScope.properties[subkey] : null}
						{@const subCompareData =
							diffMode &&
							localCompareScope &&
							'properties' in localCompareScope &&
							subkey in localCompareScope.properties
								? localCompareScope.properties[subkey]
								: null}
						{@const subCurrentData = diffMode && existsHere ? subfolder : null}
						{#if existsHere}
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
								{compact}
							/>
						{:else}
							<!-- Render ghost child to preserve spacing when this key exists only on the other side -->
							<svelte:self
								{hash}
								{source}
								{borderColor}
								key={subkey}
								folder={subCompareData}
								{requiredList}
								parent={currentId}
								expanded={true}
								{diffMode}
								diffCompareData={null}
								diffCurrentData={null}
								{diffSide}
								{compact}
								ghost={true}
							/>
						{/if}
					{/each}
				{/if}
			{/if}
		</ul>
	{/if}
</li>
