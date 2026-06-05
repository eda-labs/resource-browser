<script lang="ts">
	import { highlightMatches } from '../highlight';
	import {
		buildSideBySideRows,
		diffLineClass,
		groupDiffLines,
		type DiffSection
	} from '../diffDetails';

	export let details: string[] = [];
	export let sourceLabel = 'Source';
	export let targetLabel = 'Target';
	export let searchQuery = '';
	export let searchRegex = true;

	let activeTab: DiffSection = 'spec';

	$: groups = groupDiffLines(details);
	$: hasSpec = groups.spec.length > 0;
	$: hasStatus = groups.status.length > 0;
	$: hasOther = groups.other.length > 0;

	$: {
		if (!hasSpec && hasStatus) activeTab = 'status';
		else if (!hasSpec && !hasStatus && hasOther) activeTab = 'other';
		else if (hasSpec) activeTab = activeTab === 'spec' || (!hasStatus && !hasOther) ? activeTab : 'spec';
	}

	$: activeLines = groups[activeTab];
	$: rows = buildSideBySideRows(activeLines);

	$: tabs = [
		...(hasSpec ? [{ id: 'spec' as DiffSection, label: 'Spec', count: groups.spec.length }] : []),
		...(hasStatus ? [{ id: 'status' as DiffSection, label: 'Status', count: groups.status.length }] : []),
		...(hasOther ? [{ id: 'other' as DiffSection, label: 'Other', count: groups.other.length }] : [])
	];
</script>

<div class="comparison-schema-diff">
	{#if tabs.length > 1}
		<div class="comparison-schema-diff__tabs" role="tablist" aria-label="Diff sections">
			{#each tabs as tab}
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === tab.id}
					class="comparison-schema-diff__tab"
					class:comparison-schema-diff__tab--active={activeTab === tab.id}
					on:click={() => (activeTab = tab.id)}
				>
					{tab.label}
					<span class="comparison-schema-diff__tab-count">{tab.count}</span>
				</button>
			{/each}
		</div>
	{:else if tabs.length === 1}
		<div class="comparison-schema-diff__section-label">
			{tabs[0].label} changes
			<span class="comparison-schema-diff__tab-count">{tabs[0].count}</span>
		</div>
	{/if}

	{#if rows.length === 0}
		<p class="comparison-schema-diff__empty">No field-level changes in this section.</p>
	{:else}
		<div class="comparison-schema-diff__grid" role="table" aria-label="Schema diff">
			<div class="comparison-schema-diff__header" role="row">
				<div class="comparison-schema-diff__header-cell comparison-schema-diff__header-cell--source" role="columnheader">
					{sourceLabel}
				</div>
				<div class="comparison-schema-diff__header-cell comparison-schema-diff__header-cell--target" role="columnheader">
					{targetLabel}
				</div>
			</div>
			<div class="comparison-schema-diff__body">
				{#each rows as row (row.lineNum)}
					<div class="comparison-schema-diff__row" role="row">
						<div
							class="{diffLineClass(row.leftType)}"
							role="cell"
						>
							<span class="comparison-schema-diff__line-num" aria-hidden="true">{row.lineNum}</span>
							<span class="comparison-schema-diff__line-text">
								{#if row.left}
									{@html highlightMatches(row.left, searchQuery, searchRegex)}
								{:else}
									<span class="comparison-schema-diff__gap" aria-hidden="true">·</span>
								{/if}
							</span>
						</div>
						<div
							class="{diffLineClass(row.rightType)}"
							role="cell"
						>
							<span class="comparison-schema-diff__line-num" aria-hidden="true">{row.lineNum}</span>
							<span class="comparison-schema-diff__line-text">
								{#if row.right}
									{@html highlightMatches(row.right, searchQuery, searchRegex)}
								{:else}
									<span class="comparison-schema-diff__gap" aria-hidden="true">·</span>
								{/if}
							</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
