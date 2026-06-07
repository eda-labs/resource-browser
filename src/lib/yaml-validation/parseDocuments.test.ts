import { describe, expect, it } from 'vitest';
import { parseDocuments } from './parseDocuments';

describe('parseDocuments', () => {
	it('reports indentation errors with line numbers', () => {
		const yaml = `apiVersion: v1
kind: Config
metadata:
 name: test
  namespace: eda
`;
		const result = parseDocuments(yaml);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/YAML parsing error/i);
		expect(result.message).toMatch(/line/i);
		expect(result.line).toBeGreaterThan(0);
	});
});
