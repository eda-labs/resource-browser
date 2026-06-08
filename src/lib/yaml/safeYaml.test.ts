import { describe, expect, it } from 'vitest';
import { loadStaticYaml, loadUserYaml } from './safeYaml';

describe('safeYaml schemas', () => {
	it('loadUserYaml rejects custom YAML tags', () => {
		expect(() => loadUserYaml('!!js/function "function(){}"')).toThrow();
	});

	it('loadStaticYaml parses bundled CRD-style documents', () => {
		const doc = loadStaticYaml(`apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: example
`);
		expect(doc).toMatchObject({ kind: 'CustomResourceDefinition' });
	});
});
