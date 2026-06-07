import { describe, expect, it } from 'vitest';
import { formatYamlBundle } from './formatYaml';

describe('formatYamlBundle', () => {
	it('reformats messy indentation to 2-space CRD layout with apiVersion first', () => {
		const messy = `kind: Configlet
apiVersion: config.eda.nokia.com/v1
metadata:
    name: test
    namespace: eda
spec:
    config: hello
`;

		const result = formatYamlBundle(messy);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.docCount).toBe(1);
		expect(result.formatted).toMatch(/^apiVersion:/m);
		expect(result.formatted.indexOf('apiVersion:')).toBeLessThan(result.formatted.indexOf('kind:'));
		expect(result.formatted.indexOf('kind:')).toBeLessThan(result.formatted.indexOf('metadata:'));
		expect(result.formatted.indexOf('metadata:')).toBeLessThan(result.formatted.indexOf('spec:'));
		expect(result.formatted).not.toMatch(/^ {4,}/m);
		expect(result.formatted).toMatch(/^ {2}name: test$/m);
		expect(result.formatted).toMatch(/^ {2}namespace: eda$/m);
	});

	it('preserves multi-document separators', () => {
		const bundle = `kind: Topology
apiVersion: topologies.eda.nokia.com/v1
metadata:
  name: lab
---
apiVersion: core.eda.nokia.com/v1
kind: TopoNode
metadata:
  name: leaf-01
`;

		const result = formatYamlBundle(bundle);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.docCount).toBe(2);
		expect(result.formatted).toContain('---\n');
		expect(result.formatted.split('---\n')).toHaveLength(2);
	});

	it('returns error for unparseable YAML without mutating', () => {
		const bad = `apiVersion: v1
kind: Config
metadata:
 name: test
  namespace: eda
`;

		const result = formatYamlBundle(bad);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe('Cannot auto-fix: fix syntax first');
	});

	it('orders metadata fields before spec and status', () => {
		const yaml = `status:
  phase: Ready
spec:
  enabled: true
metadata:
  namespace: eda
  name: test
kind: Configlet
apiVersion: config.eda.nokia.com/v1
`;

		const result = formatYamlBundle(yaml);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const api = result.formatted.indexOf('apiVersion:');
		const kind = result.formatted.indexOf('kind:');
		const metadata = result.formatted.indexOf('metadata:');
		const spec = result.formatted.indexOf('spec:');
		const status = result.formatted.indexOf('status:');

		expect(api).toBeLessThan(kind);
		expect(kind).toBeLessThan(metadata);
		expect(metadata).toBeLessThan(spec);
		expect(spec).toBeLessThan(status);

		const namePos = result.formatted.indexOf('  name: test');
		const nsPos = result.formatted.indexOf('  namespace: eda');
		expect(namePos).toBeGreaterThan(-1);
		expect(nsPos).toBeGreaterThan(namePos);
	});
});
