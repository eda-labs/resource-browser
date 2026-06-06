import { describe, expect, it } from 'vitest';
import {
	classifyFieldChangeType,
	detailToFieldChange,
	isManifestBreakingChange,
	isNoiseDiffDetail
} from '$lib/comparison/fieldChangeClassifier';
import { parseDiffLine } from '$lib/comparison/diffDetails';
import type { BulkDiffReport } from '$lib/comparison/types';
import { reportToReleaseNotes } from './generateNotes';

const fixtureReport: BulkDiffReport = {
	sourceRelease: 'EDA 25.12.3',
	sourceVersion: 'v1alpha1',
	targetRelease: 'EDA 26.4.1',
	targetVersion: 'v2',
	generatedAt: '2026-01-01T00:00:00.000Z',
	crds: [
		{
			name: 'widgets.eda.nokia.com',
			kind: 'Widget',
			status: 'added',
			hasDiff: true,
			details: ['Present in target only']
		},
		{
			name: 'legacy.eda.nokia.com',
			kind: 'Legacy',
			status: 'removed',
			hasDiff: true,
			details: ['Present in source only']
		},
		{
			name: 'bgppeers.protocols.eda.nokia.com',
			kind: 'BGPPeer',
			status: 'modified',
			hasDiff: true,
			details: [
				'+ Added: spec.newField',
				'- Removed: spec.oldField',
				'~ Modified: spec.mode.type :: string → integer',
				'+ Added: status.controllerField',
				'- Removed: status.readOnlyField',
				'~ Modified: spec.label.description :: "old" → "new"',
				'No schema changes'
			]
		},
		{
			name: 'unchanged.eda.nokia.com',
			kind: 'Stable',
			status: 'unchanged',
			hasDiff: false,
			details: ['No schema changes']
		},
		{
			name: 'states.eda.nokia.com',
			kind: 'State',
			status: 'modified',
			hasDiff: true,
			details: ['+ Added: spec.hidden']
		}
	]
};

describe('fieldChangeClassifier', () => {
	it('skips noise diff detail lines', () => {
		expect(isNoiseDiffDetail('Present in target only')).toBe(true);
		expect(isNoiseDiffDetail('+ Added: spec.foo')).toBe(false);
	});

	it('parses modify lines with before/after values', () => {
		const parsed = parseDiffLine('~ Modified: spec.mode.type :: string → integer');
		expect(parsed.path).toBe('spec.mode.type');
		expect(parsed.before).toBe('string');
		expect(parsed.after).toBe('integer');
		expect(classifyFieldChangeType(parsed)).toBe('type_change');
	});

	it('classifies spec vs status breaking changes', () => {
		const specRemove = detailToFieldChange('- Removed: spec.oldField', 'Widget')!;
		const statusRemove = detailToFieldChange('- Removed: status.readOnlyField', 'Widget')!;
		const metaChange = detailToFieldChange('~ Modified: spec.label.description :: "a" → "b"', 'Widget')!;

		expect(isManifestBreakingChange(specRemove)).toBe(true);
		expect(isManifestBreakingChange(statusRemove)).toBe(false);
		expect(isManifestBreakingChange(metaChange)).toBe(false);
	});
});

describe('reportToReleaseNotes', () => {
	it('maps bulk diff report counts to release notes structure', () => {
		const notes = reportToReleaseNotes(fixtureReport, '25.12.3', '26.4.1', 'v2', [
			{
				name: 'widgets.eda.nokia.com',
				kind: 'Widget',
				group: 'eda.nokia.com'
			},
			{
				name: 'legacy.eda.nokia.com',
				kind: 'Legacy',
				group: 'eda.nokia.com'
			},
			{
				name: 'bgppeers.protocols.eda.nokia.com',
				kind: 'BGPPeer',
				group: 'protocols.eda.nokia.com'
			}
		]);

		expect(notes.newResources).toHaveLength(1);
		expect(notes.newResources[0].kind).toBe('Widget');
		expect(notes.removedResources).toHaveLength(1);
		expect(notes.modifiedResources).toHaveLength(1);
		expect(notes.modifiedResources[0].kind).toBe('BGPPeer');
		expect(notes.modifiedResources[0].changes).toHaveLength(6);

		const breakingFields = notes.breakingChanges.filter((b) => b.field !== 'resource');
		expect(breakingFields.map((b) => b.field)).toEqual(['spec.oldField', 'spec.mode.type']);
		expect(notes.totalBreakingCount).toBe(3);
		expect(notes.breakingChanges).toHaveLength(3);
	});
});
