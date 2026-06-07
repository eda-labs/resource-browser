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
	sourceVersion: 'all',
	targetRelease: 'EDA 26.4.1',
	targetVersion: 'all',
	generatedAt: '2026-01-01T00:00:00.000Z',
	crds: [
		{
			name: 'widgets.eda.nokia.com',
			kind: 'Widget',
			version: 'v1',
			status: 'added',
			hasDiff: true,
			details: ['API version v1 present in target only']
		},
		{
			name: 'legacy.eda.nokia.com',
			kind: 'Legacy',
			version: 'v1',
			status: 'removed',
			hasDiff: true,
			details: ['API version v1 present in source only']
		},
		{
			name: 'bgppeers.protocols.eda.nokia.com',
			kind: 'BGPPeer',
			version: 'v2',
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
			version: 'v1',
			status: 'unchanged',
			hasDiff: false,
			details: ['No schema changes']
		},
		{
			name: 'states.eda.nokia.com',
			kind: 'State',
			version: 'v1',
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
		const sourceCrds = [
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
		];

		const notes = reportToReleaseNotes(
			fixtureReport,
			'25.12.3',
			'26.4.1',
			[
				{
					name: 'widgets.eda.nokia.com',
					kind: 'Widget',
					group: 'eda.nokia.com'
				},
				...sourceCrds
			],
			[],
			sourceCrds
		);

		expect(notes.newResources).toHaveLength(1);
		expect(notes.newResources[0].kind).toBe('Widget');
		expect(notes.newResources[0].crdName).toBe('widgets.eda.nokia.com');
		expect(notes.newResources[0].description).toMatch(/New .* CRD introduced/);
		expect(notes.removedResources).toHaveLength(1);
		expect(notes.modifiedResources).toHaveLength(1);
		expect(notes.modifiedResources[0].kind).toBe('BGPPeer');
		expect(notes.modifiedResources[0].apiVersion).toBe('protocols.eda.nokia.com/v2');

		const fields = notes.modifiedResources[0].changes.map((c) => c.field);
		expect(fields).toContain('spec.oldField');
		expect(fields).toContain('spec.mode.type');
		expect(notes.modifiedResources).toHaveLength(1);
	});
});
