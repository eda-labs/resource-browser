import { describe, expect, it } from 'vitest';
import { walkUnknownFields } from './schemaValidator';
import type { BundleIssue, BundleResource } from './types';

function makeResource(spec: Record<string, unknown>): BundleResource {
	const rawText = `apiVersion: test.eda.nokia.com/v1
kind: TestResource
metadata:
  name: test
spec:
  members:
    - name: one
      unknownField: value
`;
	return {
		name: 'test',
		kind: 'TestResource',
		group: 'test.eda.nokia.com',
		docIndex: 0,
		data: {
			apiVersion: 'test.eda.nokia.com/v1',
			kind: 'TestResource',
			metadata: { name: 'test' },
			spec
		},
		doc: {
			data: {},
			rawText,
			startLine: 0,
			index: 0
		}
	};
}

describe('walkUnknownFields', () => {
	it('reports unknown fields inside array items', () => {
		const resource = makeResource({
			members: [{ name: 'one', unknownField: 'value' }]
		});
		const schema = {
			type: 'object',
			properties: {
				members: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' }
						}
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		const unknown = issues.filter((i) => i.message.includes('Unknown field'));
		expect(unknown).toHaveLength(1);
		expect(unknown[0].fieldPath).toBe('spec.members[0].unknownField');
		expect(unknown[0].message).toContain('TestResource');
	});

	it('does not flag known nested object fields', () => {
		const resource = makeResource({
			members: [{ name: 'one' }]
		});
		const schema = {
			type: 'object',
			properties: {
				members: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' }
						}
					}
				}
			}
		};
		const issues: BundleIssue[] = [];

		walkUnknownFields(resource.data.spec, schema, 'spec', resource.doc, '/spec/', issues, resource);

		expect(issues).toHaveLength(0);
	});
});
