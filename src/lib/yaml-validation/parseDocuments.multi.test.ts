import { describe, expect, it } from 'vitest';
import { parseDocuments } from './parseDocuments';

describe('parseDocuments multi-document errors', () => {
	it('collects parse errors from each bad document while parsing valid ones', () => {
		const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: good-one
---
apiVersion: v1
kind: Broken
metadata:
 name: bad-indent
  namespace: eda
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: good-two
---
not: [valid: yaml
`;

		const result = parseDocuments(yaml);
		expect(result.ok).toBe(false);
		if (result.ok) return;

		expect(result.docs?.length).toBe(2);
		expect(result.parseErrors?.length).toBe(2);
		expect(result.parseErrors?.[0].docIndex).toBe(2);
		expect(result.parseErrors?.[1].docIndex).toBe(4);
	});
});
