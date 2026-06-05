<script lang="ts">
	import type { EdaRelease } from '$lib/structure';

	let {
		role,
		releaseName = $bindable(''),
		version = $bindable(''),
		release = null,
		releases = [],
		versions = [],
		versionsLoading = false,
		swapping = false,
		onReleaseChange = () => {},
		onVersionChange = () => {}
	}: {
		role: 'source' | 'target';
		releaseName?: string;
		version?: string;
		release?: EdaRelease | null;
		releases?: EdaRelease[];
		versions?: string[];
		versionsLoading?: boolean;
		swapping?: boolean;
		onReleaseChange?: () => void;
		onVersionChange?: () => void;
	} = $props();

	const idPrefix = role === 'source' ? 'source' : 'target';
	const badgeClass =
		role === 'source'
			? 'comparison-release-badge comparison-release-badge--source'
			: 'comparison-release-badge comparison-release-badge--target';
	const label = role === 'source' ? 'Source' : 'Target';
</script>

<div
	class="comparison-release-card"
	class:comparison-release-card--swapping={swapping}
	data-role={role}
>
	<div class="comparison-release-card__header">
		<span class={badgeClass}>{label}</span>
		{#if release}
			<span class="comparison-release-card__label">{release.label}</span>
		{/if}
		<span class="comparison-release-card__hint">
			{role === 'source' ? 'Baseline release' : 'Compared against source'}
		</span>
	</div>

	<div class="comparison-release-card__fields">
		<div class="comparison-release-card__field">
			<label for="{idPrefix}-release" class="comparison-release-card__field-label">Release</label>
			{#if versionsLoading && !releaseName}
				<div class="comparison-skeleton comparison-skeleton--select" aria-hidden="true"></div>
			{:else}
				<select
					id="{idPrefix}-release"
					bind:value={releaseName}
					onchange={onReleaseChange}
					class="spec-search-select w-full"
				>
					<option value="">Select release…</option>
					{#each releases as r}
						<option value={r.name}>{r.label}{r.default ? ' (latest)' : ''}</option>
					{/each}
				</select>
			{/if}
		</div>

		<div class="comparison-release-card__field">
			<label for="{idPrefix}-version" class="comparison-release-card__field-label">API version</label>
			{#if versionsLoading}
				<div class="comparison-skeleton comparison-skeleton--select" aria-hidden="true"></div>
			{:else}
				<select
					id="{idPrefix}-version"
					bind:value={version}
					onchange={onVersionChange}
					disabled={!release || versions.length === 0}
					class="spec-search-select w-full disabled:cursor-not-allowed disabled:opacity-60"
				>
					<option value="">
						{versions.length === 0 ? 'No versions available' : 'Select version…'}
					</option>
					{#each versions as v}
						<option value={v}>{v}</option>
					{/each}
				</select>
			{/if}
		</div>
	</div>
</div>
