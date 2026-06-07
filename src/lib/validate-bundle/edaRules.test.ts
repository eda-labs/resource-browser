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

describe('validateEdaRules mandatory label', () => {
	it('reports missing EDA metadata label as error with mandatory-label rule', () => {
		const parsed = parseBundleResources(CONFIGLET_WITHOUT_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources, 'EDA 26.4.2');
		const labelIssue = issues.find((i) => i.rule === 'mandatory-label');

		expect(labelIssue).toBeDefined();
		expect(labelIssue?.severity).toBe('error');
		expect(labelIssue?.category).toBe('eda');
		expect(labelIssue?.fieldPath).toBe('metadata.labels');
		expect(labelIssue?.message).toContain('Required EDA metadata label missing');
		expect(labelIssue?.message).toContain('app.eda.nokia.com/managed');
		expect(labelIssue?.message).not.toContain('consider');
	});

	it('passes when an eda.nokia.com label is present', () => {
		const parsed = parseBundleResources(CONFIGLET_WITH_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateEdaRules(parsed.resources, 'EDA 26.4.2');
		expect(issues.some((i) => i.rule === 'mandatory-label')).toBe(false);
	});
});
