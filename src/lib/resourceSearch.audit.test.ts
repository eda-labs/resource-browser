import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayKind, searchResources } from './resourceSearch';
import type { CrdResource } from './structure';

const manifest = JSON.parse(
	readFileSync('static/resources/26.4.2/manifest.json', 'utf8')
) as CrdResource[];

describe('kind search audit (26.4.2 manifest)', () => {
	it('every resource ranks in top 8 when searching its display kind', () => {
		const failures: Array<{ kind: string; name: string; rank: number | null; total: number }> =
			[];

		for (const res of manifest) {
			const kind = displayKind(res);
			const query = kind.toLowerCase();
			if (!query) continue;

			const results = searchResources(manifest, query, { limit: 8 });
			if (!results.some((r) => r.name === res.name)) {
				const all = searchResources(manifest, query);
				const rank = all.findIndex((r) => r.name === res.name);
				failures.push({
					kind,
					name: res.name,
					rank: rank === -1 ? null : rank + 1,
					total: all.length
				});
			}
		}

		if (failures.length > 0) {
			console.log('homepage top-8 failures:', JSON.stringify(failures, null, 2));
		}
		expect(failures).toEqual([]);
	});

	it('every resource ranks in top 10 when searching its display kind', () => {
		const failures: string[] = [];

		for (const res of manifest) {
			const kind = displayKind(res);
			const query = kind.toLowerCase();
			if (!query) continue;

			const results = searchResources(manifest, query, { limit: 10 });
			if (!results.some((r) => r.name === res.name)) {
				failures.push(`${kind} (${res.name})`);
			}
		}

		if (failures.length > 0) {
			console.log('dep-map top-10 failures:', failures);
		}
		expect(failures).toEqual([]);
	});
});
