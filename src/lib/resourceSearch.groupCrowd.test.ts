import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayKind, searchResources } from './resourceSearch';
import type { CrdResource } from './structure';

const manifest = JSON.parse(
	readFileSync('static/resources/26.4.2/manifest.json', 'utf8')
) as CrdResource[];

/** Kinds whose lowercase form appears in many group names (interface-style crowding). */
describe('group-term crowding (26.4.2)', () => {
	it('exact-kind resources still rank in top 8 for group-heavy query terms', () => {
		const groupPrefixes = new Map<string, number>();
		for (const r of manifest) {
			const prefix = (r.group || '').split('.')[0].toLowerCase();
			if (prefix) groupPrefixes.set(prefix, (groupPrefixes.get(prefix) || 0) + 1);
		}

		const crowdedPrefixes = [...groupPrefixes.entries()]
			.filter(([, count]) => count >= 5)
			.map(([prefix]) => prefix);

		const failures: Array<{
			prefix: string;
			kind: string;
			name: string;
			rank: number;
			total: number;
		}> = [];

		for (const prefix of crowdedPrefixes) {
			const kindResources = manifest.filter(
				(r) => displayKind(r).toLowerCase() === prefix
			);
			for (const res of kindResources) {
				const results = searchResources(manifest, prefix, { limit: 8 });
				if (!results.some((r) => r.name === res.name)) {
					const all = searchResources(manifest, prefix);
					const rank = all.findIndex((r) => r.name === res.name) + 1;
					failures.push({
						prefix,
						kind: displayKind(res),
						name: res.name,
						rank,
						total: all.length
					});
				}
			}
		}

		if (failures.length) {
			console.log('group-crowd failures:', JSON.stringify(failures, null, 2));
		}
		expect(failures).toEqual([]);
	});
});
