export type NodeType = 'config' | 'state' | 'other';

export type GraphNode = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
	version: string;
	description?: string;
	shortName: string;
};

export type LinkRelation =
	| 'observes'
	| 'deploys'
	| 'references'
	| 'member'
	| 'memberOf'
	| 'bindsTo'
	| 'appliesTo'
	| 'orchestrates'
	| 'extends';

export type GraphLink = {
	id: string;
	source: string;
	target: string;
	rel: LinkRelation;
	field?: string;
	reason?: string;
	confidence?: number;
};

export type DependencyGraph = {
	nodes: GraphNode[];
	links: GraphLink[];
	releaseFolder: string;
	generatedAt: string;
};

export type BuildProgress = {
	phase: 'manifest' | 'schemas' | 'edges' | 'done';
	current: number;
	total: number;
	message?: string;
};
