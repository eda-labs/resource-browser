import { describe, expect, it } from 'vitest';
import {
	findManifestEntry,
	findManifestEntryCaseMismatch,
	formatKindCaseMismatchMessage
} from './lookup';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const topologyManifest: ManifestEntry[] = [
	{
		name: 'topologies.topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		versions: [{ name: 'v1' }]
	}
];

describe('manifest lookup', () => {
	it('matches kind and group case-sensitively', () => {
		expect(findManifestEntry(topologyManifest, 'Topology', 'topologies.eda.nokia.com')).toBeDefined();
		expect(findManifestEntry(topologyManifest, 'topology', 'topologies.eda.nokia.com')).toBeUndefined();
	});

	it('detects case-only kind mismatches for a matching group', () => {
		const mismatch = findManifestEntryCaseMismatch(
			topologyManifest,
			'topology',
			'topologies.eda.nokia.com'
		);
		expect(mismatch?.kind).toBe('Topology');
		expect(formatKindCaseMismatchMessage('Topology', 'topology')).toBe(
			'kind must match CRD exactly: expected "Topology", got "topology"'
		);
	});
});
