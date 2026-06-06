<script lang="ts">
	import { stripResourcePrefixFQDN } from '$lib/components/functions';
	import { highlightMatches } from '../highlight';
	import { resourceLinkContext } from '../links';
	import {
		STATUS_FILTERS,
		STATUS_SECTIONS,
		statusChipClass,
		matchesSearch
	} from '../comparisonUtils';
	import type { BulkDiffReport, CrdDiffEntry, DiffStatus } from '../types';
	import ComparisonSummary from './ComparisonSummary.svelte';
	import SchemaDiffPanel from './SchemaDiffPanel.svelte';
	import { downloadBulkDiffReport } from '../exportReport';

	export let report: BulkDiffReport;
	export let sourceReleaseName = '';
	export let targetReleaseName = '';
	export let sourceVersion = '';
	export let targetVersion = '';
	export let statusFilter: DiffStatus[] = [];
	export let expandedCrdNames: string[] = [];
	export let searchQuery = '';
	export let searchRegex = true;
	export let effectiveSearch = '';
	export let onToggleStatusFilter: (status: DiffStatus) => void = () => {};
	export let onToggleCrdExpand: (name: string, version: string) => void = () => {};
	export let onExpandAll: () => void = () => {};
	export let onCollapseAll: () => void = () => {};
	export let onSearchInput: () => void = () => {};
	export let onClearSearch: () => void = () => {};
	export let onToggleSearchRegex: () => void = () => {};
	export let onViewCrd: (crd: CrdDiffEntry) => void = () => {};

	function crdEntryKey(crd: CrdDiffEntry): string {
		return `${crd.name}:${crd.version}`;
	}

	function handleCardHeaderKeydown(event: KeyboardEvent, crd: CrdDiffEntry) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onToggleCrdExpand(crd.name, crd.version);
		}
	}

	$: summaryCounts = {
		added: report.crds.filter((c) => c.status === 'added').length,
		removed: report.crds.filter((c) => c.status === 'removed').length,
		modified: report.crds.filter((c) => c.status === 'modified').length,
		unchanged: report.crds.filter((c) => c.status === 'unchanged').length
	};

	$: filteredCrds = report.crds.filter((crd) => {
		if (!statusFilter.includes(crd.status)) return false;
		if (crd.name.includes('states')) return false;
		return matchesSearch(crd, effectiveSearch, searchRegex);
	});

	$: groupedSections = STATUS_SECTIONS.map((section) => ({
		...section,
		crds: filteredCrds.filter((c) => c.status === section.status)
	})).filter((s) => s.crds.length > 0);

	$: allExpanded =
		filteredCrds.length > 0 &&
		filteredCrds.every((crd) => expandedCrdNames.includes(crdEntryKey(crd)));

	function sectionIcon(icon: string): string {
		if (icon === 'plus') {
			return 'M12 4v16m8-8H4';
		}
		if (icon === 'minus') {
			return 'M20 12H4';
		}
		if (icon === 'pencil') {
			return 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
		}
		return 'M5 13l4 4L19 7';
	}
</script>

<div class="spec-search-results-panel comparison-results">
	<div class="comparison-results__header">
		<div>
			<h2 class="comparison-results__title">Comparison results</h2>
			<div class="comparison-results__release-pills">
				<span class="comparison-release-pill comparison-release-pill--source">
					{report.sourceRelease} · {report.sourceVersion}
				</span>
				<svg class="comparison-results__arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
				</svg>
				<span class="comparison-release-pill comparison-release-pill--target">
					{report.targetRelease} · {report.targetVersion}
				</span>
			</div>
		</div>
		<div class="comparison-export-toolbar" role="toolbar" aria-label="Export report">
			<span class="comparison-export-toolbar__label">Export</span>
			<button type="button" class="comparison-export-btn" on:click={() => downloadBulkDiffReport(report, 'json')}>JSON</button>
			<button type="button" class="comparison-export-btn" on:click={() => downloadBulkDiffReport(report, 'text')}>TXT</button>
			<button type="button" class="comparison-export-btn" on:click={() => downloadBulkDiffReport(report, 'markdown')}>MD</button>
			<button type="button" class="comparison-export-btn" on:click={() => downloadBulkDiffReport(report, 'csv')}>CSV</button>
		</div>
	</div>

	<div class="comparison-results__summary-wrap">
		<ComparisonSummary
			counts={summaryCounts}
			{statusFilter}
			onToggleFilter={onToggleStatusFilter}
		/>
	</div>

	<div class="comparison-results__sticky-toolbar">
		<div class="comparison-results__filters">
			{#each STATUS_FILTERS as item}
				<button
					type="button"
					on:click={() => onToggleStatusFilter(item.status)}
					class="comparison-filter-chip {statusFilter.includes(item.status)
						? `comparison-filter-chip--active ${item.chipClass}`
						: 'comparison-filter-chip--inactive'}"
				>
					<span>{summaryCounts[item.status]}</span>
					<span>{item.label}</span>
				</button>
			{/each}
		</div>

		<div class="comparison-results__search-row">
			<div class="comparison-results__search">
				<svg class="comparison-results__search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<input
					id="comparison-search"
					bind:value={searchQuery}
					on:input={onSearchInput}
					placeholder="Filter CRDs or diff paths…"
					class="comparison-results__search-input"
				/>
				{#if searchQuery}
					<button
						type="button"
						aria-label="Clear search"
						on:click={onClearSearch}
						class="comparison-results__search-clear"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>
			<div class="comparison-results__search-meta">
				<label class="comparison-results__regex">
					<input
						type="checkbox"
						bind:checked={searchRegex}
						on:change={onToggleSearchRegex}
						class="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 dark:border-slate-600"
					/>
					Regex
				</label>
				<span class="comparison-results__match-count">{filteredCrds.length} shown</span>
				<button
					type="button"
					on:click={allExpanded ? onCollapseAll : onExpandAll}
					class="comparison-results__expand-btn"
				>
					{allExpanded ? 'Collapse all' : 'Expand all'}
				</button>
			</div>
		</div>
	</div>

	{#if filteredCrds.length === 0}
		<div class="spec-search-empty">
			<div class="spec-search-empty-icon">
				<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
				</svg>
			</div>
			<h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">No matching changes</h3>
			<p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
				Adjust status filters or search terms, or run a new comparison.
			</p>
		</div>
	{:else}
		<div class="comparison-results__sections">
			{#each groupedSections as section (section.status)}
				<section class="comparison-results__section" aria-labelledby="section-{section.status}">
					<header class="comparison-results__section-header" id="section-{section.status}">
						<div class="comparison-results__section-icon comparison-results__section-icon--{section.status}">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={sectionIcon(section.icon)} />
							</svg>
						</div>
						<div>
							<h3 class="comparison-results__section-title">{section.title}</h3>
							<p class="comparison-results__section-desc">{section.description}</p>
						</div>
						<span class="comparison-results__section-count">{section.crds.length}</span>
					</header>

					<div class="comparison-results__cards">
						{#each section.crds as crd (crdEntryKey(crd))}
							{@const linkCtx = resourceLinkContext(
								crd,
								sourceReleaseName,
								targetReleaseName
							)}
							{@const expanded = expandedCrdNames.includes(crdEntryKey(crd))}
							<article class="comparison-crd-card" class:comparison-crd-card--expanded={expanded}>
								<div
									role="button"
									tabindex="0"
									class="comparison-crd-card__header"
									on:click={() => onToggleCrdExpand(crd.name, crd.version)}
									on:keydown={(event) => handleCardHeaderKeydown(event, crd)}
									aria-expanded={expanded}
								>
									<svg
										class="comparison-crd-card__chevron"
										class:comparison-crd-card__chevron--open={expanded}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
									</svg>
									<div class="comparison-crd-card__meta">
										<span class={statusChipClass(crd.status)}>
											{crd.status.charAt(0).toUpperCase() + crd.status.slice(1)}
										</span>
										<span class="comparison-crd-card__kind">{crd.kind}</span>
										<span class="comparison-crd-card__version">{crd.version}</span>
									</div>
									<div class="comparison-crd-card__name font-mono">
										{#if linkCtx}
											<button
												type="button"
												class="comparison-crd-card__link"
												title="View CRD schema"
												on:click|stopPropagation={() => onViewCrd(crd)}
											>
												{@html highlightMatches(
													stripResourcePrefixFQDN(crd.name),
													effectiveSearch,
													searchRegex
												)}
											</button>
										{:else}
											{@html highlightMatches(
												stripResourcePrefixFQDN(crd.name),
												effectiveSearch,
												searchRegex
											)}
										{/if}
									</div>
									{#if crd.details.length > 0}
										<span class="comparison-crd-card__change-count">
											{crd.details.length} change{crd.details.length === 1 ? '' : 's'}
										</span>
									{/if}
									{#if linkCtx}
										<button
											type="button"
											class="comparison-crd-card__view-btn"
											on:click|stopPropagation={() => onViewCrd(crd)}
										>
											View CRD
										</button>
									{/if}
								</div>

								{#if expanded}
									<div class="comparison-crd-card__body">
										{#if crd.status === 'modified' && crd.details.length > 0}
											<SchemaDiffPanel
												details={crd.details}
												sourceLabel="{report.sourceRelease} ({crd.version})"
												targetLabel="{report.targetRelease} ({crd.version})"
												searchQuery={effectiveSearch}
												{searchRegex}
											/>
										{:else if crd.details.length > 0}
											<ul class="comparison-crd-card__simple-list">
												{#key effectiveSearch}
													{#each crd.details as detail}
														<li class="comparison-crd-card__simple-item">
															{@html highlightMatches(detail, effectiveSearch, searchRegex)}
														</li>
													{/each}
												{/key}
											</ul>
										{:else}
											<p class="comparison-crd-card__empty">No additional details.</p>
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>
