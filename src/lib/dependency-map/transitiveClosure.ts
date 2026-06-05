import type { DependencyGraph, GraphLink, LinkRelation } from './types';

export type ChainMode = 'full' | 'direct';

type LinkEndpoint = string | { id: string };

export function linkEndpointId(endpoint: LinkEndpoint): string {
	return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

export type AdjacencyLists = {
	outgoing: Map<string, Set<string>>;
	incoming: Map<string, Set<string>>;
};

export type HighlightSets = {
	nodes: Set<string>;
	ancestors: Set<string>;
	descendants: Set<string>;
	directIncoming: Set<string>;
	directOutgoing: Set<string>;
	isHighlightedEdge: (source: string, target: string) => boolean;
};

export type TransitiveDepEntry = {
	id: string;
	depth: number;
	rel?: LinkRelation;
	field?: string;
	reason?: string;
};

export function buildAdjacencyLists(links: GraphLink[]): AdjacencyLists {
	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();

	for (const link of links) {
		const source = linkEndpointId(link.source as LinkEndpoint);
		const target = linkEndpointId(link.target as LinkEndpoint);

		let out = outgoing.get(source);
		if (!out) {
			out = new Set();
			outgoing.set(source, out);
		}
		out.add(target);

		let inc = incoming.get(target);
		if (!inc) {
			inc = new Set();
			incoming.set(target, inc);
		}
		inc.add(source);
	}

	return { outgoing, incoming };
}

function isAllowed(id: string, allowedIds?: Set<string>): boolean {
	return !allowedIds || allowedIds.has(id);
}

export function getAllDescendants(
	nodeId: string,
	outgoing: Map<string, Set<string>>,
	allowedIds?: Set<string>
): Set<string> {
	const result = new Set<string>();
	const queue: string[] = [];
	const visited = new Set<string>([nodeId]);

	for (const target of outgoing.get(nodeId) ?? []) {
		if (!isAllowed(target, allowedIds) || visited.has(target)) continue;
		visited.add(target);
		result.add(target);
		queue.push(target);
	}

	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const target of outgoing.get(current) ?? []) {
			if (!isAllowed(target, allowedIds) || visited.has(target)) continue;
			visited.add(target);
			result.add(target);
			queue.push(target);
		}
	}

	return result;
}

export function getAllAncestors(
	nodeId: string,
	incoming: Map<string, Set<string>>,
	allowedIds?: Set<string>
): Set<string> {
	const result = new Set<string>();
	const queue: string[] = [];
	const visited = new Set<string>([nodeId]);

	for (const source of incoming.get(nodeId) ?? []) {
		if (!isAllowed(source, allowedIds) || visited.has(source)) continue;
		visited.add(source);
		result.add(source);
		queue.push(source);
	}

	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const source of incoming.get(current) ?? []) {
			if (!isAllowed(source, allowedIds) || visited.has(source)) continue;
			visited.add(source);
			result.add(source);
			queue.push(source);
		}
	}

	return result;
}

function getDirectNeighbors(
	nodeId: string,
	links: GraphLink[],
	allowedIds?: Set<string>
): { incoming: Set<string>; outgoing: Set<string> } {
	const incoming = new Set<string>();
	const outgoing = new Set<string>();

	for (const link of links) {
		const source = linkEndpointId(link.source as LinkEndpoint);
		const target = linkEndpointId(link.target as LinkEndpoint);
		if (target === nodeId && isAllowed(source, allowedIds)) {
			incoming.add(source);
		}
		if (source === nodeId && isAllowed(target, allowedIds)) {
			outgoing.add(target);
		}
	}

	return { incoming, outgoing };
}

export function getHighlightSets(
	nodeId: string,
	links: GraphLink[],
	mode: ChainMode,
	allowedIds?: Set<string>
): HighlightSets {
	const direct = getDirectNeighbors(nodeId, links, allowedIds);

	if (mode === 'direct') {
		const nodes = new Set([nodeId, ...direct.incoming, ...direct.outgoing]);
		return {
			nodes,
			ancestors: direct.incoming,
			descendants: direct.outgoing,
			directIncoming: direct.incoming,
			directOutgoing: direct.outgoing,
			isHighlightedEdge: (source, target) => source === nodeId || target === nodeId
		};
	}

	const adj = buildAdjacencyLists(links);
	const ancestors = getAllAncestors(nodeId, adj.incoming, allowedIds);
	const descendants = getAllDescendants(nodeId, adj.outgoing, allowedIds);
	const nodes = new Set([nodeId, ...ancestors, ...descendants]);

	const ancestorZone = new Set([nodeId, ...ancestors]);
	const descendantZone = new Set([nodeId, ...descendants]);

	return {
		nodes,
		ancestors,
		descendants,
		directIncoming: direct.incoming,
		directOutgoing: direct.outgoing,
		isHighlightedEdge: (source, target) =>
			(ancestorZone.has(source) && ancestorZone.has(target)) ||
			(descendantZone.has(source) && descendantZone.has(target))
	};
}

export function buildTransitiveDepList(
	rootId: string,
	links: GraphLink[],
	direction: 'outgoing' | 'incoming',
	mode: ChainMode,
	allowedIds?: Set<string>
): TransitiveDepEntry[] {
	const linkByPair = new Map<string, GraphLink>();
	for (const link of links) {
		const source = linkEndpointId(link.source as LinkEndpoint);
		const target = linkEndpointId(link.target as LinkEndpoint);
		linkByPair.set(`${source}|${target}`, link);
	}

	const adj = buildAdjacencyLists(links);
	const result: TransitiveDepEntry[] = [];
	const visited = new Set<string>([rootId]);

	type QueueItem = { id: string; depth: number; parentId: string };
	const queue: QueueItem[] = [];

	const seedNeighbors =
		direction === 'outgoing'
			? [...(adj.outgoing.get(rootId) ?? [])]
			: [...(adj.incoming.get(rootId) ?? [])];

	for (const id of seedNeighbors) {
		if (!isAllowed(id, allowedIds) || visited.has(id)) continue;
		visited.add(id);
		const link =
			direction === 'outgoing'
				? linkByPair.get(`${rootId}|${id}`)
				: linkByPair.get(`${id}|${rootId}`);
		result.push({ id, depth: 1, rel: link?.rel, field: link?.field, reason: link?.reason });
		queue.push({ id, depth: 1, parentId: rootId });
	}

	while (queue.length > 0) {
		const { id: current, depth, parentId } = queue.shift()!;

		if (mode === 'direct') continue;

		const neighbors =
			direction === 'outgoing'
				? [...(adj.outgoing.get(current) ?? [])]
				: [...(adj.incoming.get(current) ?? [])];

		for (const neighborId of neighbors) {
			if (!isAllowed(neighborId, allowedIds) || visited.has(neighborId)) continue;
			visited.add(neighborId);
			const link =
				direction === 'outgoing'
					? linkByPair.get(`${current}|${neighborId}`)
					: linkByPair.get(`${neighborId}|${current}`);
			result.push({
				id: neighborId,
				depth: depth + 1,
				rel: link?.rel,
				field: link?.field,
				reason: link?.reason
			});
			queue.push({ id: neighborId, depth: depth + 1, parentId: current });
		}
	}

	result.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
	return result;
}

export function getTransitiveClosureNodeIds(nodeId: string, links: GraphLink[]): Set<string> {
	const adj = buildAdjacencyLists(links);
	const ancestors = getAllAncestors(nodeId, adj.incoming);
	const descendants = getAllDescendants(nodeId, adj.outgoing);
	return new Set([nodeId, ...ancestors, ...descendants]);
}

export function extractSubgraph(graph: DependencyGraph, focusNodeId: string): DependencyGraph | null {
	if (!graph.nodes.some((n) => n.id === focusNodeId)) return null;

	const nodeIds = getTransitiveClosureNodeIds(focusNodeId, graph.links);
	const nodes = graph.nodes.filter((n) => nodeIds.has(n.id));
	const links = graph.links.filter((link) => {
		const source = linkEndpointId(link.source as LinkEndpoint);
		const target = linkEndpointId(link.target as LinkEndpoint);
		return nodeIds.has(source) && nodeIds.has(target);
	});

	return {
		nodes,
		links,
		releaseFolder: graph.releaseFolder,
		generatedAt: graph.generatedAt
	};
}
