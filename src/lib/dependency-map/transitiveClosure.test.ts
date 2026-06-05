import { describe, expect, it } from 'vitest';
import {
	buildAdjacencyLists,
	extractSubgraph,
	getAllAncestors,
	getAllDescendants,
	getHighlightSets
} from './transitiveClosure';
import type { GraphLink } from './types';

function link(source: string, target: string): GraphLink {
	return { id: `${source}|${target}|references`, source, target, rel: 'references' };
}

describe('transitiveClosure', () => {
	it('traverses multi-hop outgoing and incoming chains', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const adj = buildAdjacencyLists(links);

		expect([...getAllDescendants('a', adj.outgoing)]).toEqual(['b', 'c']);
		expect([...getAllAncestors('a', adj.incoming)]).toEqual(['d']);
	});

	it('full mode includes transitive nodes beyond direct neighbors', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const highlight = getHighlightSets('a', links, 'full');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'c', 'd']);
		expect(highlight.directOutgoing.size).toBe(1);
		expect(highlight.descendants.size).toBe(2);
		expect(highlight.directIncoming.size).toBe(1);
		expect(highlight.ancestors.size).toBe(1);
	});

	it('direct mode stays at level 1', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a')];
		const highlight = getHighlightSets('a', links, 'direct');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'd']);
	});

	it('normalizes D3-style object link endpoints', () => {
		const links = [
			{ ...link('a', 'b'), source: { id: 'a' }, target: { id: 'b' } },
			{ ...link('b', 'c'), source: { id: 'b' }, target: { id: 'c' } }
		] as Parameters<typeof getHighlightSets>[1];
		const highlight = getHighlightSets('a', links, 'full');

		expect([...highlight.nodes].sort()).toEqual(['a', 'b', 'c']);
	});

	it('extractSubgraph keeps only transitive closure around focus node', () => {
		const links = [link('a', 'b'), link('b', 'c'), link('d', 'a'), link('x', 'y')];
		const graph = {
			nodes: [
				{ id: 'a', kind: 'A', group: 'g', type: 'config' as const, version: 'v1', shortName: 'a' },
				{ id: 'b', kind: 'B', group: 'g', type: 'config' as const, version: 'v1', shortName: 'b' },
				{ id: 'c', kind: 'C', group: 'g', type: 'config' as const, version: 'v1', shortName: 'c' },
				{ id: 'd', kind: 'D', group: 'g', type: 'config' as const, version: 'v1', shortName: 'd' },
				{ id: 'x', kind: 'X', group: 'g', type: 'config' as const, version: 'v1', shortName: 'x' },
				{ id: 'y', kind: 'Y', group: 'g', type: 'config' as const, version: 'v1', shortName: 'y' }
			],
			links,
			releaseFolder: '26.4.2',
			generatedAt: '2026-01-01T00:00:00.000Z'
		};

		const subgraph = extractSubgraph(graph, 'a');
		expect(subgraph).not.toBeNull();
		expect([...subgraph!.nodes.map((n) => n.id)].sort()).toEqual(['a', 'b', 'c', 'd']);
		expect(subgraph!.links).toHaveLength(3);
	});
});
