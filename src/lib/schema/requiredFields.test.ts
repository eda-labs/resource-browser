import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import {
	collectMissingRequiredFields,
	getRequiredFields,
	resolveObjectSchema
} from './requiredFields';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const targetNodeYaml = readFileSync(
	join(root, 'static/resources/26.4.2/targetnodes.core.eda.nokia.com/v1.yaml'),
	'utf8'
);
const targetNodeSchema = loadStaticYaml(targetNodeYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
};
const specSchema = targetNodeSchema.schema?.openAPIV3Schema?.properties?.spec;

describe('requiredFields', () => {
	it('resolves top-level spec required fields', () => {
		expect(getRequiredFields(specSchema)).toEqual(['address', 'operatingSystem']);
	});

	it('resolves nested required fields from object properties', () => {
		const dhcp4 = resolveObjectSchema(specSchema)?.properties.dhcp4;
		expect(getRequiredFields(dhcp4)).toEqual(['address', 'options']);
	});

	it('resolves required fields on array item objects', () => {
		const dhcp4 = resolveObjectSchema(specSchema)?.properties.dhcp4;
		const optionsSchema = resolveObjectSchema(dhcp4)?.properties.options;
		const itemsSchema = (optionsSchema as Record<string, unknown>).items;
		expect(getRequiredFields(itemsSchema)).toEqual(['option', 'value']);
	});

	it('merges required fields from allOf branches', () => {
		const merged = resolveObjectSchema({
			allOf: [{ required: ['configs'] }, { properties: { version: { type: 'string' } } }]
		});
		expect(merged?.required).toEqual(['configs']);
		expect(merged?.properties.version).toBeDefined();
	});

	it('reports missing top-level and nested required fields', () => {
		const missing = collectMissingRequiredFields(
			{
				dhcp4: {
					options: [{}]
				}
			},
			specSchema
		);
		const paths = missing.map((err) => err.path).sort();
		expect(paths).toContain('address');
		expect(paths).toContain('operatingSystem');
		expect(paths).toContain('dhcp4.address');
		expect(paths).toContain('dhcp4.options[0].option');
		expect(paths).toContain('dhcp4.options[0].value');
	});
});
