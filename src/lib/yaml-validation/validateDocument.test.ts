import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { getOrCompileValidator } from './schemaCache';
import { validateDocument } from './validateDocument';
import type { ManifestEntry, ParsedDocument } from './types';

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
		versions: [{ name: 'v1' }]
	}
];

const specSchema = {
	type: 'object',
	properties: {
		operatingSystem: {
			type: 'string',
			enum: ['srl', 'sros', 'eos']
		}
	}
};

function makeDoc(spec: Record<string, unknown>): ParsedDocument {
	const rawText = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: test-configlet
  namespace: eda
spec:
  operatingSystem: ${spec.operatingSystem}
`;
	return {
		data: {
			apiVersion: 'config.eda.nokia.com/v1',
			kind: 'Configlet',
			metadata: { name: 'test-configlet', namespace: 'eda' },
			spec
		},
		rawText,
		startLine: 0,
		index: 0
	};
}

describe('validateDocument error accumulation', () => {
	it('reports multiple prerequisite errors in one document', () => {
		const doc: ParsedDocument = {
			data: { metadata: {} },
			rawText: 'metadata: {}\n',
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		const messages = result.errors.map((e) => e.message).join('\n');
		expect(messages).toContain("Missing required 'apiVersion'");
		expect(messages).toContain("Missing required 'kind'");
		expect(messages).toContain("Missing required 'metadata.name'");
		expect(result.errors.length).toBeGreaterThanOrEqual(3);
	});
});

describe('validateDocument CRD resolution', () => {
	it('errors when kind and apiVersion group do not match a manifest CRD', () => {
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'config.eda.nokia.com/v1',
				kind: 'NotARealKind',
				metadata: { name: 'test-resource', namespace: 'eda' },
				spec: {}
			},
			rawText: `apiVersion: config.eda.nokia.com/v1
kind: NotARealKind
metadata:
  name: test-resource
  namespace: eda
spec: {}
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) =>
					e.message.includes("kind 'NotARealKind' is not supported for apiVersion") &&
					e.message.includes("Expected kind 'Configlet'")
			)
		).toBe(true);
	});

	it('errors when kind case does not match the manifest CRD', () => {
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'topologies.eda.nokia.com/v1',
				kind: 'topology',
				metadata: { name: 'test-topology', namespace: 'eda' },
				spec: {}
			},
			rawText: `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: test-topology
  namespace: eda
spec: {}
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) =>
				e.message.includes(`Invalid kind: 'topology' must be 'Topology'`)
			)
		).toBe(true);
		const kindError = result.errors.find((e) => e.message.includes('Invalid kind:'));
		expect(kindError?.suggestedFix).toEqual({ field: 'kind', value: 'Topology', line: 2 });
	});

	it('errors when apiVersion group case does not match the manifest CRD', () => {
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'Topologies.eda.nokia.com/v1',
				kind: 'Topology',
				metadata: { name: 'test-topology', namespace: 'eda' },
				spec: {}
			},
			rawText: `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: test-topology
  namespace: eda
spec: {}
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) =>
				e.message.includes(`Invalid apiVersion: 'Topologies.eda.nokia.com/v1'`)
			)
		).toBe(true);
		const apiError = result.errors.find((e) => e.message.includes('Invalid apiVersion:'));
		expect(apiError?.suggestedFix).toEqual({
			field: 'apiVersion',
			value: 'topologies.eda.nokia.com/v1',
			line: 1
		});
	});

	it('errors when apiVersion group does not match the manifest entry for the kind', () => {
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'wrong.group/v1',
				kind: 'Configlet',
				metadata: { name: 'test-resource', namespace: 'eda' },
				spec: {}
			},
			rawText: `apiVersion: wrong.group/v1
kind: Configlet
metadata:
  name: test-resource
  namespace: eda
spec: {}
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) =>
				e.message.includes(`Invalid apiVersion: 'wrong.group/v1'`)
			)
		).toBe(true);
	});

	it('errors when apiVersion group is a typo for a known kind', () => {
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'topologi.eda.nokia.com/v1',
				kind: 'Topology',
				metadata: { name: 'test-topology', namespace: 'eda' },
				spec: {}
			},
			rawText: `apiVersion: topologi.eda.nokia.com/v1
kind: Topology
metadata:
  name: test-topology
  namespace: eda
spec: {}
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map(),
			getSpecValidator: () => {
				throw new Error('schema validation should not run');
			},
			getStatusValidator: () => {
				throw new Error('schema validation should not run');
			}
		});

		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) =>
				e.message.includes(`Invalid apiVersion: 'topologi.eda.nokia.com/v1'`)
			)
		).toBe(true);
		expect(
			result.errors.some((e) =>
				e.message.includes(`Use 'topologies.eda.nokia.com/v1' for kind Topology`)
			)
		).toBe(true);
		const apiError = result.errors.find((e) => e.message.includes('Invalid apiVersion:'));
		expect(apiError?.suggestedFix?.value).toBe('topologies.eda.nokia.com/v1');
	});

	it('proceeds to schema validation when kind case matches the manifest CRD', () => {
		const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
		const validator = getOrCompileValidator(ajv, 'topology::spec', specSchema);
		const doc: ParsedDocument = {
			data: {
				apiVersion: 'topologies.eda.nokia.com/v1',
				kind: 'Topology',
				metadata: { name: 'test-topology', namespace: 'eda' },
				spec: { operatingSystem: 'srl' }
			},
			rawText: `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: test-topology
  namespace: eda
spec:
  operatingSystem: srl
`,
			startLine: 0,
			index: 0
		};

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map([
				[
					'/resources/26.4.2/topologies.topologies.eda.nokia.com/v1.yaml',
					{ spec: specSchema, isSpecRequired: true }
				]
			]),
			getSpecValidator: () => validator,
			getStatusValidator: () => validator
		});

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

describe('validateDocument enum handling', () => {
	it('reports enum case mismatches with exact-case guidance', () => {
		const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
		const validator = getOrCompileValidator(ajv, 'test::spec', specSchema);
		const doc = makeDoc({ operatingSystem: 'SRL' });

		const result = validateDocument({
			doc,
			totalDocs: 1,
			releaseFolder: 'resources/26.4.2',
			releaseLabel: 'EDA 26.4.2',
			manifest,
			schemas: new Map([
				[
					'/resources/26.4.2/configlets.config.eda.nokia.com/v1.yaml',
					{ spec: specSchema, isSpecRequired: true }
				]
			]),
			getSpecValidator: () => validator,
			getStatusValidator: () => validator
		});

		expect(result.valid).toBe(false);
		const enumError = result.errors.find((e) => e.keyword === 'enum');
		expect(enumError).toBeDefined();
		expect(enumError?.message).toContain('exact case');
		expect(enumError?.message).toContain("'SRL'");
		expect(enumError?.message).toContain('srl');
	});
});
