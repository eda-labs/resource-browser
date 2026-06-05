<script lang="ts">
	import type { DiffStatus } from '../types';

	export let counts: {
		added: number;
		removed: number;
		modified: number;
		unchanged: number;
	};
	export let statusFilter: DiffStatus[] = [];
	export let onToggleFilter: (status: DiffStatus) => void = () => {};

	const items: {
		status: DiffStatus;
		label: string;
		icon: string;
		modifier: string;
	}[] = [
		{ status: 'added', label: 'Added', icon: '+', modifier: 'added' },
		{ status: 'removed', label: 'Removed', icon: '−', modifier: 'removed' },
		{ status: 'modified', label: 'Modified', icon: '~', modifier: 'modified' },
		{ status: 'unchanged', label: 'Unchanged', icon: '=', modifier: 'unchanged' }
	];
</script>

<div class="comparison-summary" role="group" aria-label="Comparison summary">
	{#each items as item}
		<button
			type="button"
			class="comparison-summary-card comparison-summary-card--{item.modifier}"
			class:comparison-summary-card--active={statusFilter.includes(item.status)}
			on:click={() => onToggleFilter(item.status)}
			aria-pressed={statusFilter.includes(item.status)}
		>
			<span class="comparison-summary-card__icon" aria-hidden="true">{item.icon}</span>
			<span class="comparison-summary-card__count">{counts[item.status]}</span>
			<span class="comparison-summary-card__label">{item.label}</span>
		</button>
	{/each}
</div>
