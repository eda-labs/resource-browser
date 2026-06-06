import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { generateBulkDiffReport, mergeCrdCatalogs } from './diffEngine';

const sourceRelease: EdaRelease = {
	name: '25.12.3',
	label: 'EDA 25.12.3',
	folder: 'resources/source'
};

const targetRelease: EdaRelease = {
	name: '26.4.1',
	label: 'EDA 26.4.1',
	folder: 'resources/target'
};

const mockCrd: CrdResource = {
	name: 'aggregateroutes.protocols.eda.nokia.com',
	group: 'protocols.eda.nokia.com',
	kind: 'AggregateRoute',
	versions: [
		{ name: 'v1', deprecated: false, appVersion: '' },
		{ name: 'v2', deprecated: false, appVersion: '' }
	]
};

function yamlBody(version: string, marker: string): string {
	return `apiVersion: protocols.eda.nokia.com/${version}
kind: AggregateRoute
schema:
  openAPIV3Schema:
    properties:
      spec:
        type: object
        properties:
          marker:
            type: string
            default: "${marker}"
      status:
        type: object
        properties: {}
`;
}

describe('mergeCrdCatalogs', () => {
	it('merges CRDs from source and target by name', () => {
		const source: CrdResource[] = [
			{ name: 'a.example.com', group: 'example.com', kind: 'A', versions: [] }
		];
		const target: CrdResource[] = [
			{ name: 'b.example.com', group: 'example.com', kind: 'B', versions: [] }
		];
		const merged = mergeCrdCatalogs(source, target);
		expect(merged.map((c) => c.name).sort()).toEqual(['a.example.com', 'b.example.com']);
	});
});

describe('generateBulkDiffReport', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('compares each apiVersion against its matching pair (v1↔v1, v2↔v2)', async () => {
		const manifestCache = new Map();
		manifestCache.set('resources/source', [
			{
				name: mockCrd.name,
				group: mockCrd.group,
				kind: mockCrd.kind,
				versions: [{ name: 'v1' }, { name: 'v2' }]
			}
		]);
		manifestCache.set('resources/target', [
			{
				name: mockCrd.name,
				group: mockCrd.group,
				kind: mockCrd.kind,
				versions: [{ name: 'v1' }, { name: 'v2' }]
			}
		]);

		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (init?.method === 'HEAD') {
				if (url.includes('/aggregateroutes.protocols.eda.nokia.com/v1.yaml')) {
					return new Response(null, { status: 200 });
				}
				if (url.includes('/aggregateroutes.protocols.eda.nokia.com/v2.yaml')) {
					return new Response(null, { status: 200 });
				}
				return new Response(null, { status: 404 });
			}

			if (url.endsWith('/resources/source/manifest.json')) {
				return new Response(JSON.stringify(manifestCache.get('resources/source')), { status: 200 });
			}
			if (url.endsWith('/resources/target/manifest.json')) {
				return new Response(JSON.stringify(manifestCache.get('resources/target')), { status: 200 });
			}
			if (url.includes('/resources/source/aggregateroutes.protocols.eda.nokia.com/v1.yaml')) {
				return new Response(yamlBody('v1', 'source-v1'), { status: 200 });
			}
			if (url.includes('/resources/target/aggregateroutes.protocols.eda.nokia.com/v1.yaml')) {
				return new Response(yamlBody('v1', 'target-v1'), { status: 200 });
			}
			if (url.includes('/resources/source/aggregateroutes.protocols.eda.nokia.com/v2.yaml')) {
				return new Response(yamlBody('v2', 'source-v2'), { status: 200 });
			}
			if (url.includes('/resources/target/aggregateroutes.protocols.eda.nokia.com/v2.yaml')) {
				return new Response(yamlBody('v2', 'target-v2'), { status: 200 });
			}
			return new Response(null, { status: 404 });
		});

		vi.stubGlobal('fetch', fetchMock);

		const report = await generateBulkDiffReport({
			sourceRelease,
			targetRelease,
			crdMeta: [mockCrd],
			manifestCache,
			yamlCache: new Map()
		});

		const entries = report.crds.filter((c) => c.name === mockCrd.name);
		expect(entries.map((e) => e.version).sort()).toEqual(['v1', 'v2']);

		const v1 = entries.find((e) => e.version === 'v1');
		const v2 = entries.find((e) => e.version === 'v2');

		expect(v1?.status).toBe('modified');
		expect(v1?.hasDiff).toBe(true);
		expect(v2?.status).toBe('modified');
		expect(v2?.hasDiff).toBe(true);
		expect(v2?.details.some((d) => d.includes('spec.marker'))).toBe(true);
	});

	it('marks apiVersions present only in target as added', async () => {
		const manifestCache = new Map();
		manifestCache.set('resources/source', [
			{
				name: mockCrd.name,
				group: mockCrd.group,
				kind: mockCrd.kind,
				versions: [{ name: 'v1' }]
			}
		]);
		manifestCache.set('resources/target', [
			{
				name: mockCrd.name,
				group: mockCrd.group,
				kind: mockCrd.kind,
				versions: [{ name: 'v1' }, { name: 'v2' }]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string' ? input : input.toString();
				if (init?.method === 'HEAD') {
					if (url.includes('/aggregateroutes.protocols.eda.nokia.com/v1.yaml')) {
						return new Response(null, { status: 200 });
					}
					if (url.includes('/resources/target/aggregateroutes.protocols.eda.nokia.com/v2.yaml')) {
						return new Response(null, { status: 200 });
					}
					return new Response(null, { status: 404 });
				}
				if (url.endsWith('/resources/source/manifest.json')) {
					return new Response(JSON.stringify(manifestCache.get('resources/source')), { status: 200 });
				}
				if (url.endsWith('/resources/target/manifest.json')) {
					return new Response(JSON.stringify(manifestCache.get('resources/target')), { status: 200 });
				}
				if (url.includes('v1.yaml')) {
					return new Response(yamlBody('v1', 'same'), { status: 200 });
				}
				if (url.includes('/resources/target/aggregateroutes.protocols.eda.nokia.com/v2.yaml')) {
					return new Response(yamlBody('v2', 'new'), { status: 200 });
				}
				return new Response(null, { status: 404 });
			})
		);

		const report = await generateBulkDiffReport({
			sourceRelease,
			targetRelease,
			crdMeta: [mockCrd],
			manifestCache,
			yamlCache: new Map()
		});

		const v2 = report.crds.find((c) => c.name === mockCrd.name && c.version === 'v2');
		expect(v2?.status).toBe('added');
	});
});
