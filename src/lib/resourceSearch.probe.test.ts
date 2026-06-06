import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { displayKind, searchResources } from './resourceSearch';
import type { CrdResource } from './structure';

const manifest = JSON.parse(
	readFileSync('static/resources/26.4.2/manifest.json', 'utf8')
) as CrdResource[];

describe('search probes (26.4.2)', () => {
	it('logs crowded-term and plural-alias behavior', () => {
		const crowdedTerms = ['interface', 'routing', 'policy', 'node', 'core', 'protocol'];
		for (const term of crowdedTerms) {
			const all = searchResources(manifest, term);
			const top8 = searchResources(manifest, term, { limit: 8 });
			console.log(
				`term=${term} matches=${all.length} top8=${top8.map((r) => displayKind(r)).join(',')}`
			);
		}

		const pluralPairs: Array<[string, string]> = [
			['toponode', 'TopoNode'],
			['toponodes', 'TopoNode'],
			['interface', 'Interface'],
			['interfaces', 'Interface'],
			['policy', 'Policy'],
			['policies', 'Policy']
		];
		for (const [query, expectedKind] of pluralPairs) {
			const top8 = searchResources(manifest, query, { limit: 8 });
			const rank =
				top8.findIndex((r) => r.kind === expectedKind) + 1 ||
				searchResources(manifest, query).findIndex((r) => r.kind === expectedKind) + 1;
			console.log(
				`plural query=${query} expected=${expectedKind} inTop8=${top8.some((r) => r.kind === expectedKind)} rank=${rank || 'not found'}`
			);
		}

		const dupKinds = new Map<string, CrdResource[]>();
		for (const r of manifest.filter((x) => x.kind)) {
			const k = r.kind.toLowerCase();
			if (!dupKinds.has(k)) dupKinds.set(k, []);
			dupKinds.get(k)!.push(r);
		}
		const dups = [...dupKinds.entries()].filter(([, v]) => v.length > 1);
		console.log(`duplicate kind count=${dups.length}`);
		for (const [k, rs] of dups) {
			const q = k;
			const top10 = searchResources(manifest, q, { limit: 10 });
			console.log(
				`dup kind=${k} groups=${rs.map((r) => r.group).join('|')} top10=${top10.map((r) => r.group).join(',')}`
			);
		}
	});
});
