import { describe, expect, it } from 'vitest';
import { applySuggestedFix } from './applyIssueFix';
import type { BundleIssue } from './types';

describe('applySuggestedFix', () => {
	it('replaces apiVersion on the matching line', () => {
		const yaml = `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-1',
			severity: 'error',
			category: 'schema',
			message: 'Invalid apiVersion',
			docIndex: 1,
			line: 1,
			fieldPath: '/apiVersion',
			suggestedFix: { field: 'apiVersion', value: 'topologies.eda.nokia.com/v1', line: 1 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('apiVersion: topologies.eda.nokia.com/v1');
		expect(updated).not.toContain('Topologies.eda.nokia.com');
	});

	it('replaces kind case on the matching line', () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-2',
			severity: 'error',
			category: 'schema',
			message: 'Invalid kind',
			docIndex: 1,
			line: 2,
			fieldPath: '/kind',
			suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('kind: Topology');
	});

	it('replaces metadata.name underscores', () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: my_topology
  namespace: eda
`;

		const issue: BundleIssue = {
			id: 'test-3',
			severity: 'error',
			category: 'kubernetes',
			message: 'invalid metadata.name',
			docIndex: 1,
			line: 4,
			fieldPath: 'metadata.name',
			suggestedFix: { field: 'metadata.name', value: 'my-topology', line: 4 }
		};

		const updated = applySuggestedFix(yaml, issue);
		expect(updated).toContain('name: my-topology');
	});
});
