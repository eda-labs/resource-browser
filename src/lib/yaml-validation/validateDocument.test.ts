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
