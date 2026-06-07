import { describe, expect, it } from 'vitest';
import { parseBundleResources } from './parser';
import { tryFixDnsLabel, tryFixDnsSubdomain, validateK8sRules } from './k8sRules';

const VALID_CONFIGLET = `apiVersion: config.eda.nokia.com/v1
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

const CONFIGLET_INVALID_NAME = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: Invalid_Name
  namespace: eda
spec:
  config: test
`;

const CONFIGLET_INVALID_NAMESPACE = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: Invalid_Namespace
spec:
  config: test
`;

const CONFIGLET_INVALID_LABEL = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
  labels:
    bad key!: value
spec:
  config: test
`;

const CONFIGLET_INVALID_LABEL_VALUE = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
  labels:
    app.kubernetes.io/name: ${'x'.repeat(64)}
spec:
  config: test
`;

const MANIFEST_WITH_SPEC_AND_STATUS = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
spec:
  config: test
status:
  phase: Ready
`;

const MISSING_API_VERSION = `kind: Configlet
metadata:
  name: test
  namespace: eda
spec:
  config: test
`;

const INVALID_API_VERSION = `apiVersion: not/a/valid/format
kind: Configlet
metadata:
  name: test
  namespace: eda
spec:
  config: test
`;

const CORE_API_VERSION = `apiVersion: v1
kind: ConfigMap
metadata:
  name: test-map
  namespace: default
data:
  key: value
`;

describe('validateK8sRules', () => {
	it('passes a valid manifest', () => {
		const parsed = parseBundleResources(VALID_CONFIGLET);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(validateK8sRules(parsed.resources)).toHaveLength(0);
	});

	it('errors when metadata.namespace is missing', () => {
		const parsed = parseBundleResources(CONFIGLET_WITHOUT_NAMESPACE);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		const namespaceIssue = issues.find((i) => i.rule === 'required-metadata-namespace');

		expect(namespaceIssue).toBeDefined();
		expect(namespaceIssue?.severity).toBe('error');
		expect(namespaceIssue?.category).toBe('kubernetes');
		expect(namespaceIssue?.fieldPath).toBe('metadata.namespace');
	});

	it('errors when apiVersion is missing', () => {
		const parsed = parseBundleResources(MISSING_API_VERSION);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'required-apiVersion')).toBe(true);
	});

	it('errors when apiVersion format is invalid', () => {
		const parsed = parseBundleResources(INVALID_API_VERSION);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-apiVersion-format')).toBe(true);
	});

	it('accepts core apiVersion format', () => {
		const parsed = parseBundleResources(CORE_API_VERSION);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-apiVersion-format')).toBe(false);
	});

	it('errors on invalid metadata.name DNS subdomain', () => {
		const parsed = parseBundleResources(CONFIGLET_INVALID_NAME);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-metadata-name')).toBe(true);
	});

	it('errors on invalid metadata.namespace DNS label', () => {
		const parsed = parseBundleResources(CONFIGLET_INVALID_NAMESPACE);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-metadata-namespace')).toBe(true);
	});

	it('errors on invalid label keys', () => {
		const parsed = parseBundleResources(CONFIGLET_INVALID_LABEL);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-label-key')).toBe(true);
	});

	it('errors on label values exceeding 63 characters', () => {
		const parsed = parseBundleResources(CONFIGLET_INVALID_LABEL_VALUE);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		expect(issues.some((i) => i.rule === 'invalid-label-value')).toBe(true);
	});

	it('warns when both spec and status are present', () => {
		const parsed = parseBundleResources(MANIFEST_WITH_SPEC_AND_STATUS);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const issues = validateK8sRules(parsed.resources);
		const specStatusIssue = issues.find((i) => i.rule === 'spec-with-status');

		expect(specStatusIssue).toBeDefined();
		expect(specStatusIssue?.severity).toBe('warning');
		expect(specStatusIssue?.category).toBe('kubernetes');
		expect(specStatusIssue?.message).toContain('both spec and status');
	});
});

describe('tryFixDnsSubdomain', () => {
	it('fixes underscores and uppercase in metadata.name candidates', () => {
		expect(tryFixDnsSubdomain('my_topology')).toBe('my-topology');
		expect(tryFixDnsSubdomain('Invalid_Name')).toBe('invalid-name');
	});

	it('returns null for already-valid names', () => {
		expect(tryFixDnsSubdomain('my-topology')).toBeNull();
	});

	it('returns null for unfixable names', () => {
		expect(tryFixDnsSubdomain('!!!')).toBeNull();
	});
});

describe('tryFixDnsLabel', () => {
	it('fixes underscores and uppercase in namespace candidates', () => {
		expect(tryFixDnsLabel('Invalid_Namespace')).toBe('invalid-namespace');
	});

	it('collapses repeated hyphens and trims edges', () => {
		expect(tryFixDnsLabel('__my--ns__')).toBe('my-ns');
	});
});
