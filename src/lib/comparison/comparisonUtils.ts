import type { CrdDiffEntry, DiffStatus } from './types';

export const STATUS_FILTERS: { status: DiffStatus; label: string; chipClass: string }[] = [
	{ status: 'added', label: 'Added', chipClass: 'comparison-filter-chip--added' },
	{ status: 'removed', label: 'Removed', chipClass: 'comparison-filter-chip--removed' },
	{ status: 'modified', label: 'Modified', chipClass: 'comparison-filter-chip--modified' },
	{ status: 'unchanged', label: 'Unchanged', chipClass: 'comparison-filter-chip--unchanged' }
];

export const STATUS_SECTIONS: {
	status: DiffStatus;
	title: string;
	description: string;
	icon: 'plus' | 'minus' | 'pencil' | 'check';
}[] = [
	{
		status: 'added',
		title: 'Added CRDs',
		description: 'Present in target release only',
		icon: 'plus'
	},
	{
		status: 'removed',
		title: 'Removed CRDs',
		description: 'Present in source release only',
		icon: 'minus'
	},
	{
		status: 'modified',
		title: 'Modified CRDs',
		description: 'Schema changes in spec or status',
		icon: 'pencil'
	},
	{
		status: 'unchanged',
		title: 'Unchanged CRDs',
		description: 'No schema differences detected',
		icon: 'check'
	}
];

export function statusChipClass(status: DiffStatus): string {
	if (status === 'added') return 'comparison-status-chip comparison-status-chip--added';
	if (status === 'removed') return 'comparison-status-chip comparison-status-chip--removed';
	if (status === 'modified') return 'comparison-status-chip comparison-status-chip--modified';
	return 'comparison-status-chip comparison-status-chip--unchanged';
}

export function matchesSearch(
	crd: CrdDiffEntry,
	effectiveSearch: string,
	searchRegex: boolean
): boolean {
	const q = String(effectiveSearch ?? '').trim();
	if (!q) return true;
	const details = crd.details
		? crd.details.map((d) => d.replace(/\b(spec|status)\./gi, '')).join(' ')
		: '';
	const hay = `${crd.name} ${crd.kind} ${crd.version} ${details}`;
	if (searchRegex) {
		try {
			return new RegExp(q, 'i').test(hay);
		} catch {
			return hay.toLowerCase().includes(q.toLowerCase());
		}
	}
	const alphaOnly = /^[A-Za-z0-9_]+$/.test(q);
	if (alphaOnly) {
		try {
			return new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay);
		} catch {
			/* fallback */
		}
	}
	return hay.toLowerCase().includes(q.toLowerCase());
}

export function compareHint(
	canCompare: boolean,
	generating: boolean,
	sourceVersionsLoading: boolean,
	targetVersionsLoading: boolean,
	sourceReleaseLabel: string | undefined,
	sourceVersion: string,
	targetReleaseLabel: string | undefined,
	targetVersion: string
): string {
	if (generating) return 'Comparison in progress…';
	if (sourceVersionsLoading || targetVersionsLoading) return 'Loading release manifests and API versions…';
	if (canCompare) {
		if (sourceVersion && targetVersion && sourceVersion === targetVersion) {
			return `Ready — compare ${sourceReleaseLabel} → ${targetReleaseLabel} (${sourceVersion} only). Press Enter to run.`;
		}
		return `Ready — compare ${sourceReleaseLabel} → ${targetReleaseLabel} (all API versions paired by name). Press Enter to run.`;
	}
	if (!sourceReleaseLabel || !targetReleaseLabel) return 'Select source and target releases to compare.';
	return 'Choose different source and target releases to compare.';
}
