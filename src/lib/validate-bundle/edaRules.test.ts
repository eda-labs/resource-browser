import { describe, expect, it } from 'vitest';
import { parseBundleResources } from './parser';
import { validateEdaRules } from './edaRules';

const CONFIGLET_WITHOUT_NAMESPACE = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
spec:
  config: |
    network-instance vrf-customer-a {
      type ip-vrf
    }
`;

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

const MANIFEST_WITH_SPEC_AND_STATUS = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
spec:
  config: |
    network-instance vrf-customer-a {
      type ip-vrf
    }
status:
  phase: Ready
`;

describe('validateEdaRules', () => {
	it('errors when metadata.namespace is missing', () => {
		const parsed = parseBundleResources(CONFIGLET_WITHOUT_NAMESPACE);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources);
		const namespaceIssue = issues.find((i) => i.rule === 'required-namespace');

		expect(namespaceIssue).toBeDefined();
		expect(namespaceIssue?.severity).toBe('error');
		expect(namespaceIssue?.category).toBe('eda');
		expect(namespaceIssue?.fieldPath).toBe('metadata.namespace');
		expect(namespaceIssue?.message).toContain('metadata.namespace is required');
	});

	it('does not warn about missing EDA metadata labels', () => {
		const parsed = parseBundleResources(CONFIGLET_WITHOUT_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources);
		expect(issues).toHaveLength(0);
	});

	it('warns when both spec and status are present', () => {
		const parsed = parseBundleResources(MANIFEST_WITH_SPEC_AND_STATUS);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources);
		const specStatusIssue = issues.find((i) => i.rule === 'spec-with-status');

		expect(specStatusIssue).toBeDefined();
		expect(specStatusIssue?.severity).toBe('warning');
		expect(specStatusIssue?.category).toBe('eda');
		expect(specStatusIssue?.message).toContain('both spec and status');
	});
});
