import { describe, expect, it } from 'vitest';
import {
	findManifestEntry,
	findManifestEntryCaseInsensitive,
	findManifestEntryCaseMismatch,
	findManifestEntryGroupCaseMismatch,
	findManifestEntryKindCaseMismatchInsensitive,
	formatInvalidApiVersionMessage,
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
			`Invalid kind: 'topology' must be 'Topology' (Kubernetes kinds are case-sensitive).`
		);
	});

	it('detects case-only group mismatches for a matching kind', () => {
		const mismatch = findManifestEntryGroupCaseMismatch(
			topologyManifest,
			'Topology',
			'Topologies.eda.nokia.com'
		);
		expect(mismatch?.group).toBe('topologies.eda.nokia.com');
	});

	it('detects kind case mismatches when group matches case-insensitively', () => {
		const mismatch = findManifestEntryKindCaseMismatchInsensitive(
			topologyManifest,
			'topology',
			'Topologies.eda.nokia.com'
		);
		expect(mismatch?.kind).toBe('Topology');
	});

	it('finds a unique case-insensitive manifest entry', () => {
		const entry = findManifestEntryCaseInsensitive(
			topologyManifest,
			'topology',
			'Topologies.eda.nokia.com'
		);
		expect(entry?.kind).toBe('Topology');
		expect(entry?.group).toBe('topologies.eda.nokia.com');
	});

	it('formats apiVersion mismatch messages with suggested value', () => {
		expect(
			formatInvalidApiVersionMessage(
				'Topologies.eda.nokia.com/v1',
				'topologies.eda.nokia.com/v1',
				'Topology'
			)
		).toBe(
			`Invalid apiVersion: 'Topologies.eda.nokia.com/v1' is not defined for this release. Use 'topologies.eda.nokia.com/v1' for kind Topology.`
		);
	});
});
