import { describe, expect, it, vi } from 'vitest';
import {
	fixApiVersionUpgrade,
	fixDocumentData,
	fixK8sMetadata,
	fixManifestIdentity,
	formatFixSummary,
	formatYamlBundle
} from './formatYaml';
import { pickLatestApiVersion } from '$lib/versions';
import type { SchemaSections } from '$lib/yaml-validation/schemaCache';
import type { ManifestEntry } from '$lib/yaml-validation/types';

const specSchema = {
	type: 'object',
	properties: {
		operatingSystem: {
			type: 'string',
			enum: ['srl', 'sros', 'eos']
		},
		asNumber: {
			type: 'string'
		},
		enabled: {
			type: 'boolean'
		}
	}
};

const sections: SchemaSections = {
	spec: specSchema,
	isSpecRequired: true
};

vi.mock('$lib/yaml-validation/schemaCache', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/yaml-validation/schemaCache')>();
	const mockSections: SchemaSections = {
		spec: {
			type: 'object',
			properties: {
				operatingSystem: { type: 'string', enum: ['srl', 'sros', 'eos'] },
				asNumber: { type: 'string' },
				enabled: { type: 'boolean' }
			}
		},
		isSpecRequired: true
	};
	return {
		...actual,
		fetchSchemas: vi.fn(async (paths: string[]) => {
			const map = new Map<string, SchemaSections>();
			for (const path of paths) {
				map.set(path, mockSections);
			}
			return map;
		})
	};
});

describe('formatYamlBundle', () => {
	it('reformats messy indentation to 2-space CRD layout with apiVersion first', async () => {
		const messy = `kind: Configlet
apiVersion: config.eda.nokia.com/v1
metadata:
    name: test
    namespace: eda
spec:
    config: hello
`;

		const result = await formatYamlBundle(messy);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.docCount).toBe(1);
		expect(result.fixes).toEqual([]);
		expect(result.formatted).toMatch(/^apiVersion:/m);
		expect(result.formatted.indexOf('apiVersion:')).toBeLessThan(result.formatted.indexOf('kind:'));
		expect(result.formatted.indexOf('kind:')).toBeLessThan(result.formatted.indexOf('metadata:'));
		expect(result.formatted.indexOf('metadata:')).toBeLessThan(result.formatted.indexOf('spec:'));
		expect(result.formatted).not.toMatch(/^ {4,}/m);
		expect(result.formatted).toMatch(/^ {2}name: test$/m);
		expect(result.formatted).toMatch(/^ {2}namespace: eda$/m);
	});

	it('preserves multi-document separators', async () => {
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

		const result = await formatYamlBundle(bundle);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.docCount).toBe(2);
		expect(result.formatted).toContain('---\n');
		expect(result.formatted.split('---\n')).toHaveLength(2);
	});

	it('returns error for unparseable YAML without mutating', async () => {
		const bad = `apiVersion: v1
kind: Config
metadata:
 name: test
  namespace: eda
`;

		const result = await formatYamlBundle(bad);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBe('Cannot auto-fix: fix syntax first');
	});

	it('orders metadata fields before spec and status', async () => {
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

		const result = await formatYamlBundle(yaml);
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

describe('fixDocumentData', () => {
	it('fixes enum case mismatches to canonical schema values', () => {
		const data = {
			apiVersion: 'config.eda.nokia.com/v1',
			kind: 'Configlet',
			metadata: { name: 'test', namespace: 'eda' },
			spec: { operatingSystem: 'SRL' }
		};

		const { data: fixed, fixes } = fixDocumentData(data, sections, 1);

		expect((fixed.spec as Record<string, unknown>).operatingSystem).toBe('srl');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'enumCase',
			path: 'spec.operatingSystem',
			from: 'SRL',
			to: 'srl',
			docIndex: 1
		});
	});

	it('coerces numeric values to strings when schema expects string', () => {
		const data = {
			apiVersion: 'config.eda.nokia.com/v1',
			kind: 'Configlet',
			metadata: { name: 'test', namespace: 'eda' },
			spec: { asNumber: 65000 }
		};

		const { data: fixed, fixes } = fixDocumentData(data, sections, 1);

		expect((fixed.spec as Record<string, unknown>).asNumber).toBe('65000');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'stringCoercion',
			path: 'spec.asNumber',
			from: 65000,
			to: '65000'
		});
	});

	it('does not guess enum values without a unique case-insensitive match', () => {
		const data = {
			spec: { operatingSystem: 'ios' }
		};

		const { data: fixed, fixes } = fixDocumentData(data, sections, 1);

		expect((fixed.spec as Record<string, unknown>).operatingSystem).toBe('ios');
		expect(fixes).toHaveLength(0);
	});

	it('coerces wrongly-cased boolean strings', () => {
		const data = {
			spec: { enabled: 'False' }
		};

		const { data: fixed, fixes } = fixDocumentData(data, sections, 1);

		expect((fixed.spec as Record<string, unknown>).enabled).toBe(false);
		expect(fixes).toHaveLength(1);
		expect(fixes[0].kind).toBe('booleanCoercion');
	});
});

const manifest: ManifestEntry[] = [
	{
		name: 'configlets.config.eda.nokia.com',
		kind: 'Configlet',
		group: 'config.eda.nokia.com',
		versions: [{ name: 'v1' }]
	},
	{
		name: 'topologies.topologies.eda.nokia.com',
		kind: 'Topology',
		group: 'topologies.eda.nokia.com',
		versions: [{ name: 'v1alpha1' }, { name: 'v1' }]
	}
];

describe('pickLatestApiVersion', () => {
	it('prefers stable v1 over v1alpha1 and v1beta1', () => {
		const latest = pickLatestApiVersion([
			{ name: 'v1alpha1' },
			{ name: 'v1beta1' },
			{ name: 'v1' }
		]);
		expect(latest).toBe('v1');
	});

	it('skips deprecated versions when a non-deprecated alternative exists', () => {
		const latest = pickLatestApiVersion([
			{ name: 'v1alpha1', deprecated: true },
			{ name: 'v1' }
		]);
		expect(latest).toBe('v1');
	});
});

describe('fixApiVersionUpgrade', () => {
	it('upgrades v1alpha1 to v1 when v1 is available', () => {
		const data = {
			apiVersion: 'topologies.eda.nokia.com/v1alpha1',
			kind: 'Topology',
			metadata: { name: 'lab', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixApiVersionUpgrade(data, manifest, 1);

		expect(fixed.apiVersion).toBe('topologies.eda.nokia.com/v1');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'apiVersionUpgrade',
			path: 'apiVersion',
			from: 'topologies.eda.nokia.com/v1alpha1',
			to: 'topologies.eda.nokia.com/v1'
		});
	});

	it('leaves documents already on the latest version unchanged', () => {
		const data = {
			apiVersion: 'topologies.eda.nokia.com/v1',
			kind: 'Topology',
			metadata: { name: 'lab', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixApiVersionUpgrade(data, manifest, 1);

		expect(fixed.apiVersion).toBe('topologies.eda.nokia.com/v1');
		expect(fixes).toHaveLength(0);
	});
});

describe('formatYamlBundle apiVersion upgrade', () => {
	it('upgrades apiVersion to latest non-deprecated version when manifest is available', async () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1alpha1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec: {}
`;

		const result = await formatYamlBundle(yaml, {
			releaseFolder: 'resources/26.4.2',
			manifest
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.formatted).toContain('apiVersion: topologies.eda.nokia.com/v1');
		expect(result.fixes.some((f) => f.kind === 'apiVersionUpgrade')).toBe(true);
	});
});

describe('fixManifestIdentity', () => {
	it('fixes apiVersion group casing to manifest canonical group', () => {
		const data = {
			apiVersion: 'Topologies.eda.nokia.com/v1',
			kind: 'Topology',
			metadata: { name: 'lab', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixManifestIdentity(data, manifest, 1);

		expect(fixed.apiVersion).toBe('topologies.eda.nokia.com/v1');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'apiVersionCase',
			path: 'apiVersion',
			from: 'Topologies.eda.nokia.com/v1',
			to: 'topologies.eda.nokia.com/v1'
		});
	});

	it('fixes kind casing when group matches case-insensitively', () => {
		const data = {
			apiVersion: 'topologies.eda.nokia.com/v1',
			kind: 'topology',
			metadata: { name: 'lab', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixManifestIdentity(data, manifest, 1);

		expect(fixed.kind).toBe('Topology');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'kindCase',
			path: 'kind',
			from: 'topology',
			to: 'Topology'
		});
	});
});

describe('formatYamlBundle auto-fix output', () => {
	it('applies schema fixes and quotes coerced string fields in output', async () => {
		const yaml = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: test
  namespace: eda
spec:
  operatingSystem: SRL
  asNumber: 65000
`;

		const result = await formatYamlBundle(yaml, {
			releaseFolder: 'resources/26.4.2',
			manifest
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.fixes).toHaveLength(2);
		expect(result.formatted).toMatch(/operatingSystem: srl/);
		expect(result.formatted).toMatch(/asNumber: ['"]65000['"]/);
	});

	it('fixes apiVersion group casing in formatted output', async () => {
		const yaml = `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda
spec: {}
`;

		const result = await formatYamlBundle(yaml, {
			releaseFolder: 'resources/26.4.2',
			manifest
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.formatted).toContain('apiVersion: topologies.eda.nokia.com/v1');
		expect(result.fixes.some((f) => f.kind === 'apiVersionCase')).toBe(true);
	});
});

describe('fixK8sMetadata', () => {
	it('replaces underscores in metadata.name with hyphens', () => {
		const data = {
			apiVersion: 'topologies.eda.nokia.com/v1',
			kind: 'Topology',
			metadata: { name: 'my_topology', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixK8sMetadata(data, 1);

		expect((fixed.metadata as Record<string, unknown>).name).toBe('my-topology');
		expect(fixes).toHaveLength(1);
		expect(fixes[0]).toMatchObject({
			kind: 'dnsName',
			path: 'metadata.name',
			from: 'my_topology',
			to: 'my-topology'
		});
	});

	it('fixes invalid metadata.namespace DNS labels', () => {
		const data = {
			metadata: { name: 'test', namespace: 'Invalid_Namespace' }
		};

		const { data: fixed, fixes } = fixK8sMetadata(data, 1);

		expect((fixed.metadata as Record<string, unknown>).namespace).toBe('invalid-namespace');
		expect(fixes[0].path).toBe('metadata.namespace');
	});

	it('leaves valid DNS names unchanged', () => {
		const data = {
			metadata: { name: 'my-topology', namespace: 'eda' }
		};

		const { data: fixed, fixes } = fixK8sMetadata(data, 1);

		expect((fixed.metadata as Record<string, unknown>).name).toBe('my-topology');
		expect(fixes).toHaveLength(0);
	});
});

describe('formatYamlBundle k8s and boolean fixes', () => {
	it('fixes metadata.name underscores and normalizes False to false in output', async () => {
		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: my_topology
  namespace: eda
spec:
  enabled: False
`;

		const result = await formatYamlBundle(yaml);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.formatted).toMatch(/name: my-topology/);
		expect(result.formatted).toMatch(/enabled: false/);
		expect(result.fixes.some((f) => f.kind === 'dnsName')).toBe(true);
	});
});

describe('formatFixSummary', () => {
	it('summarizes fix counts by category', () => {
		const summary = formatFixSummary(
			[
				{ kind: 'enumCase', path: 'spec.os', from: 'SRL', to: 'srl', docIndex: 1 },
				{ kind: 'enumCase', path: 'spec.type', from: 'EVPN', to: 'evpn', docIndex: 1 },
				{ kind: 'stringCoercion', path: 'spec.port', from: 65000, to: '65000', docIndex: 2 }
			],
			2
		);
		expect(summary.layoutOnly).toBe(false);
		expect(summary.headline).toBe('Fixed 3 issues in 2 documents');
		expect(summary.items).toHaveLength(2);
		expect(summary.items[0]).toMatchObject({ kind: 'enumCase', count: 2, label: 'Fixed 2 enum cases' });
		expect(summary.items[1]).toMatchObject({
			kind: 'stringCoercion',
			count: 1,
			label: "Coerced string: 65000 → 65000"
		});
	});

	it('reports DNS names and booleans in user-friendly labels', () => {
		const summary = formatFixSummary(
			[
				{ kind: 'dnsName', path: 'metadata.name', from: 'a_b', to: 'a-b', docIndex: 1 },
				{ kind: 'dnsName', path: 'metadata.namespace', from: 'X_Y', to: 'x-y', docIndex: 1 },
				{ kind: 'booleanCoercion', path: 'spec.enabled', from: 'False', to: false, docIndex: 1 },
				{ kind: 'enumCase', path: 'spec.os', from: 'SRL', to: 'srl', docIndex: 1 },
				{ kind: 'enumCase', path: 'spec.type', from: 'EVPN', to: 'evpn', docIndex: 1 },
				{ kind: 'enumCase', path: 'spec.mode', from: 'L2', to: 'l2', docIndex: 1 }
			],
			1
		);
		expect(summary.headline).toBe('Fixed 6 issues in 1 document');
		expect(summary.items.map((i) => i.label)).toEqual([
			'Fixed 2 DNS names',
			'Fixed 3 enum cases',
			'Fixed boolean: False → false'
		]);
	});

	it('reports layout-only formatting when no fixes were applied', () => {
		const summary = formatFixSummary([], 3);
		expect(summary.layoutOnly).toBe(true);
		expect(summary.headline).toBe('Formatted 3 documents (layout only)');
		expect(summary.items).toHaveLength(0);
	});
});
