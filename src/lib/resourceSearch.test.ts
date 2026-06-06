import { describe, expect, it } from 'vitest';
import { matchesResourceQuery, searchResources } from './resourceSearch';
import type { CrdResource } from '$lib/structure';

const sampleResources: CrdResource[] = [
	{
		name: 'analyzealarms.interfaces.eda.nokia.com',
		group: 'interfaces.eda.nokia.com',
		kind: '',
		versions: []
	},
	{
		name: 'breakouts.interfaces.eda.nokia.com',
		group: 'interfaces.eda.nokia.com',
		kind: 'Breakout',
		versions: []
	},
	{
		name: 'interfaces.interfaces.eda.nokia.com',
		group: 'interfaces.eda.nokia.com',
		kind: 'Interface',
		versions: []
	},
	{
		name: 'defaultinterfaces.routing.eda.nokia.com',
		group: 'routing.eda.nokia.com',
		kind: 'DefaultInterface',
		versions: []
	}
];

describe('resourceSearch', () => {
	it('matches kind, name, and group like catalog search', () => {
		expect(matchesResourceQuery(sampleResources[2], 'interface')).toBe(true);
		expect(matchesResourceQuery(sampleResources[0], 'interface')).toBe(true);
		expect(matchesResourceQuery(sampleResources[1], 'breakout')).toBe(true);
	});

	it('ranks exact kind matches before group-only hits', () => {
		const results = searchResources(sampleResources, 'interface', { limit: 3 });
		expect(results[0]?.kind).toBe('Interface');
	});

	it('returns all matching CRDs when no limit is set', () => {
		const results = searchResources(sampleResources, 'interface');
		expect(results.some((r) => r.kind === 'Interface')).toBe(true);
		expect(results.length).toBe(
			sampleResources.filter((r) => matchesResourceQuery(r, 'interface')).length
		);
	});
});
