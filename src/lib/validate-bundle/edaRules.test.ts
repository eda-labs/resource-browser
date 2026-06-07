import { describe, expect, it } from 'vitest';
import { parseBundleResources } from './parser';
import { validateEdaRules } from './edaRules';

const CONFIGLET_WITHOUT_LABEL = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
spec:
  config: |
    network-instance vrf-customer-a {
      type ip-vrf
    }
`;

const CONFIGLET_WITH_LABEL = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
  labels:
    app.eda.nokia.com/managed: "true"
spec:
  config: |
    network-instance vrf-customer-a {
      type ip-vrf
    }
`;

const TOPOLOGY_WITHOUT_LABEL = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab-topology
  namespace: eda
spec:
  enabled: true
  overlays:
    - enabled: true
      key: default
`;

describe('validateEdaRules recommended label', () => {
	it('reports missing EDA metadata label as warning with recommended-label rule', () => {
		const parsed = parseBundleResources(CONFIGLET_WITHOUT_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources, 'EDA 26.4.2');
		const labelIssue = issues.find((i) => i.rule === 'recommended-label');

		expect(labelIssue).toBeDefined();
		expect(labelIssue?.severity).toBe('warning');
		expect(labelIssue?.category).toBe('eda');
		expect(labelIssue?.fieldPath).toBe('metadata.labels');
		expect(labelIssue?.message).toContain('Recommended EDA metadata label missing');
		expect(labelIssue?.message).toContain('app.eda.nokia.com/managed');
		expect(labelIssue?.message).not.toContain('Required');
	});

	it('reports missing label on Topology without failing bundle validation severity', () => {
		const parsed = parseBundleResources(TOPOLOGY_WITHOUT_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources, 'EDA 26.4.2');
		const labelIssue = issues.find((i) => i.rule === 'recommended-label');

		expect(labelIssue).toBeDefined();
		expect(labelIssue?.severity).toBe('warning');
		expect(labelIssue?.resourceKind).toBe('Topology');
		expect(labelIssue?.resourceName).toBe('lab-topology');
	});

	it('passes when an eda.nokia.com label is present', () => {
		const parsed = parseBundleResources(CONFIGLET_WITH_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources, 'EDA 26.4.2');
		expect(issues.some((i) => i.rule === 'recommended-label')).toBe(false);
	});
});
