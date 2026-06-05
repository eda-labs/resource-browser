import type { CrdResource } from '$lib/structure';
import type { GraphLink, GraphNode, LinkRelation, NodeType } from './types';

type CatalogEntry = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
	description?: string;
};

type IntentMatch = {
	kind: string;
	rel: LinkRelation;
	confidence: number;
	reason: string;
};

type PendingEdge = {
	source: string;
	target: string;
	rel: LinkRelation;
	field?: string;
	reason: string;
	confidence: number;
};

const STOP_KINDS = new Set([
	'API',
	'Node',
	'Object',
	'REST',
	'Schema',
	'Server',
	'String',
	'Type',
	'Value',
	'CamelCase',
	'Default'
]);

const REL_PRIORITY: Record<LinkRelation, number> = {
	observes: 100,
	deploys: 100,
	orchestrates: 90,
	extends: 85,
	bindsTo: 80,
	appliesTo: 78,
	member: 70,
	memberOf: 70,
	references: 60
};

const MIN_CONFIDENCE = 55;

const DESCRIPTION_INTENT_PATTERNS: Array<{
	regex: RegExp;
	rel: LinkRelation | ((kind: string, description: string) => LinkRelation);
	confidence: number;
	reason: (kind: string, description: string) => string;
}> = [
	{
		regex: /Reference to (?:a|an) ([A-Z][A-Za-z0-9]+)/g,
		rel: (kind, desc) => (kind === 'Policy' && /route|policy|evaluat/i.test(desc) ? 'appliesTo' : 'references'),
		confidence: 95,
		reason: (kind) => `Description references ${kind}`
	},
	{
		regex: /Reference to ([A-Z][A-Za-z0-9]+)(?:\s|$|[.,])/g,
		rel: (kind, desc) => (kind === 'Policy' ? 'appliesTo' : 'references'),
		confidence: 90,
		reason: (kind) => `Description references ${kind}`
	},
	{
		regex: /List of ([A-Z][A-Za-z0-9]+)(?:\s+references?|\s+resource|\s+in|\s|$)/gi,
		rel: 'references',
		confidence: 88,
		reason: (kind) => `Description lists ${kind} resources`
	},
	{
		regex: /(?:selects?|Selects)\s+(?:to\s+)?(?:a\s+|an\s+|the\s+)?([A-Z][A-Za-z0-9]+)/g,
		rel: 'references',
		confidence: 85,
		reason: (kind) => `Description selects ${kind}`
	},
	{
		regex: /select(?:s|ing)?\s+([A-Z][A-Za-z0-9]+)\s+to\s+configure/gi,
		rel: 'bindsTo',
		confidence: 85,
		reason: (kind) => `Description binds configuration to ${kind}`
	},
	{
		regex: /creating an?\s+([A-Z][A-Za-z0-9]+)\s+resource/gi,
		rel: 'orchestrates',
		confidence: 92,
		reason: (kind) => `Description orchestrates creation of ${kind}`
	},
	{
		regex: /members?\s+of\s+the\s+([A-Z][A-Za-z0-9]+)/gi,
		rel: 'member',
		confidence: 82,
		reason: (kind) => `Description indicates membership in ${kind}`
	},
	{
		regex: /Name of the ([A-Z][A-Za-z0-9]+)/g,
		rel: 'references',
		confidence: 80,
		reason: (kind) => `Field holds ${kind} identity`
	},
	{
		regex: /operational state of the following resources[^:]*:\s*([A-Z][A-Za-z0-9]+(?:,\s*[A-Z][A-Za-z0-9]+)*)/gi,
		rel: 'references',
		confidence: 68,
		reason: (kind) => `Status tracks ${kind} operational state`
	},
	{
		regex: /resources emitted by the Fabric such as ([A-Z][A-Za-z0-9]+)/gi,
		rel: 'orchestrates',
		confidence: 72,
		reason: (kind) => `Fabric orchestrates ${kind}`
	},
	{
		regex: /\b(Keychain)s?\b/gi,
		rel: 'references',
		confidence: 84,
		reason: (kind) => `Description references ${kind}`
	},
	{
		regex: /([A-Z][A-Za-z0-9]+)\s+resource(?:s)?(?:\s|$|[.,])/g,
		rel: 'references',
		confidence: 65,
		reason: (kind) => `Description mentions ${kind} resource`
	}
];

const FIELD_INTENT_PATTERNS: Array<{
	propPattern: RegExp;
	kind: string;
	rel: LinkRelation;
	confidence: number;
	reason: string;
}> = [
	{
		propPattern: /^interSwitchLinks$/i,
		kind: 'ISL',
		rel: 'orchestrates',
		confidence: 78,
		reason: 'Fabric inter-switch link configuration orchestrates ISL'
	},
	{
		propPattern: /^fabricSelectors$/i,
		kind: 'Fabric',
		rel: 'references',
		confidence: 80,
		reason: 'Fabric selector references peer Fabric instances'
	},
	{
		propPattern: /^linkSelectors$/i,
		kind: 'TopoLink',
		rel: 'references',
		confidence: 82,
		reason: 'Link selector references TopoLink resources'
	},
	{
		propPattern: /NodeSelectors?$/i,
		kind: 'TopoNode',
		rel: 'bindsTo',
		confidence: 80,
		reason: 'Node selector binds fabric roles to TopoNode'
	},
	{
		propPattern: /^asnPool$/i,
		kind: 'IndexAllocationPool',
		rel: 'references',
		confidence: 88,
		reason: 'ASN pool field references IndexAllocationPool'
	},
	{
		propPattern: /^(poolIPv4|poolIPv6|systemPoolIPv4|systemPoolIPv6)$/i,
		kind: 'IPAllocationPool',
		rel: 'references',
		confidence: 88,
		reason: 'IP pool field references IPAllocationPool'
	},
	{
		propPattern: /^keychain$/i,
		kind: 'Keychain',
		rel: 'references',
		confidence: 85,
		reason: 'Keychain field references Keychain resource'
	},
	{
		propPattern: /^(exportPolicy|importPolicy|exportPolicies|importPolicies)$/i,
		kind: 'Policy',
		rel: 'appliesTo',
		confidence: 86,
		reason: 'Routing policy field applies Policy'
	}
];

const REFERENCE_FIELD_PATTERN = /(?:Ref|Reference|Selector|resourceRef)$/i;

function shortResourceName(name: string): string {
	return name.split('.')[0] ?? name;
}

export function classifyNodeType(name: string, kind: string): NodeType {
	const lower = name.toLowerCase();
	const short = shortResourceName(lower);
	if (kind.endsWith('State') || short.endsWith('states') || lower.includes('.states.')) {
		return 'state';
	}
	if (kind.endsWith('Deployment') || short.endsWith('deployments')) {
		return 'config';
	}
	return 'config';
}

function normalizeKindKey(kind: string): string {
	return kind.replace(/\s+/g, '').toLowerCase();
}

function kindLookupKeys(kind: string): string[] {
	const key = normalizeKindKey(kind);
	const keys = new Set<string>([key]);
	if (key.endsWith('ies') && key.length > 4) {
		keys.add(`${key.slice(0, -3)}y`);
	}
	if (key.endsWith('s') && key.length > 2) {
		keys.add(key.slice(0, -1));
	}
	if (!key.endsWith('s')) {
		keys.add(`${key}s`);
	}
	return [...keys];
}

function buildKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const entry of catalog.values()) {
		const kind = entry.kind || shortResourceName(entry.id);
		for (const key of kindLookupKeys(kind)) {
			const list = index.get(key) ?? [];
			if (!list.includes(entry.id)) list.push(entry.id);
			index.set(key, list);
		}
	}
	return index;
}

function resolveKindTarget(
	kind: string,
	sourceGroup: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): string | null {
	if (STOP_KINDS.has(kind)) return null;

	const candidates = new Set<string>();
	for (const key of kindLookupKeys(kind)) {
		for (const id of kindIndex.get(key) ?? []) {
			candidates.add(id);
		}
	}
	if (candidates.size === 0) return null;

	const list = [...candidates];
	if (list.length === 1) return list[0];

	const sameGroup = list.filter((id) => catalog.get(id)?.group === sourceGroup);
	if (sameGroup.length === 1) return sameGroup[0];

	const sourceShort = normalizeKindKey(kind);
	const exactKind = list.filter((id) => {
		const entry = catalog.get(id);
		if (!entry) return false;
		const entryKind = entry.kind || shortResourceName(entry.id);
		return kindLookupKeys(entryKind).includes(sourceShort);
	});
	if (exactKind.length === 1) return exactKind[0];

	return list[0] ?? null;
}

function resolveNameSibling(
	sourceName: string,
	fromSuffix: string,
	toSuffix: string,
	catalog: Map<string, CatalogEntry>
): string | null {
	const short = shortResourceName(sourceName);
	if (!short.endsWith(fromSuffix)) return null;
	const rest = sourceName.slice(short.length);
	const targetShort = short.slice(0, -fromSuffix.length) + toSuffix;
	const targetName = targetShort + rest;
	return catalog.has(targetName) ? targetName : null;
}

function resolveRel(
	rel: LinkRelation | ((kind: string, description: string) => LinkRelation),
	kind: string,
	description: string
): LinkRelation {
	return typeof rel === 'function' ? rel(kind, description) : rel;
}

function extractIntentFromDescription(description: string, path: string): IntentMatch[] {
	const matches: IntentMatch[] = [];
	const seen = new Set<string>();

	for (const pattern of DESCRIPTION_INTENT_PATTERNS) {
		for (const match of description.matchAll(pattern.regex)) {
			const kind = match[1];
			if (!kind || kind.length < 2 || STOP_KINDS.has(kind)) continue;

			if (pattern.regex.source.includes('operational state')) {
				const resourceList = kind.split(/,\s*/);
				for (const resourceKind of resourceList) {
					const trimmed = resourceKind.trim();
					if (!trimmed || STOP_KINDS.has(trimmed)) continue;
					const rel = resolveRel(pattern.rel, trimmed, description);
					const dedupe = `${trimmed}|${rel}|${path}`;
					if (seen.has(dedupe)) continue;
					seen.add(dedupe);
					matches.push({
						kind: trimmed,
						rel,
						confidence: pattern.confidence,
						reason: `${pattern.reason(trimmed, description)} (${path})`
					});
				}
				continue;
			}

			const rel = resolveRel(pattern.rel, kind, description);
			const dedupe = `${kind}|${rel}|${path}`;
			if (seen.has(dedupe)) continue;
			seen.add(dedupe);
			matches.push({
				kind,
				rel,
				confidence: pattern.confidence,
				reason: `${pattern.reason(kind, description)} (${path})`
			});
		}
	}

	return matches;
}

function extractIntentFromField(
	propName: string,
	description: string | undefined,
	path: string
): IntentMatch[] {
	const matches: IntentMatch[] = [];

	for (const fieldPattern of FIELD_INTENT_PATTERNS) {
		if (!fieldPattern.propPattern.test(propName)) continue;
		matches.push({
			kind: fieldPattern.kind,
			rel: fieldPattern.rel,
			confidence: fieldPattern.confidence,
			reason: `${fieldPattern.reason} (${path})`
		});
	}

	if (REFERENCE_FIELD_PATTERN.test(propName) && description) {
		for (const intent of extractIntentFromDescription(description, path)) {
			matches.push({
				...intent,
				confidence: Math.max(intent.confidence, 70)
			});
		}
	}

	return matches;
}

function walkSchema(
	node: unknown,
	path: string,
	onProperty: (name: string, description: string | undefined, path: string) => void,
	onDescription: (description: string, path: string) => void
): void {
	if (!node || typeof node !== 'object') return;
	const n = node as Record<string, unknown>;

	if (typeof n.description === 'string' && n.description.trim()) {
		onDescription(n.description, path);
	}

	if (n.properties && typeof n.properties === 'object') {
		for (const [key, val] of Object.entries(n.properties as Record<string, unknown>)) {
			const child = val as Record<string, unknown> | undefined;
			const childPath = path ? `${path}.${key}` : key;
			onProperty(
				key,
				typeof child?.description === 'string' ? child.description : undefined,
				childPath
			);
			walkSchema(val, childPath, onProperty, onDescription);
		}
	}

	if (n.additionalProperties && typeof n.additionalProperties === 'object') {
		walkSchema(n.additionalProperties, `${path}.*`, onProperty, onDescription);
	}

	if (n.items) {
		walkSchema(n.items, `${path}[]`, onProperty, onDescription);
	}

	for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
		if (Array.isArray(n[comb])) {
			for (const el of n[comb]) {
				walkSchema(el, path, onProperty, onDescription);
			}
		}
	}
}

function addPendingEdge(pending: PendingEdge[], edge: PendingEdge, allowSelf = false): void {
	if (edge.source === edge.target && !allowSelf) return;
	if (edge.confidence < MIN_CONFIDENCE) return;
	pending.push(edge);
}

function mergeEdgeCandidates<T extends PendingEdge | GraphLink>(
	edges: T[],
	toPending: (edge: T) => PendingEdge
): GraphLink[] {
	const byPair = new Map<string, PendingEdge>();

	for (const edge of edges) {
		const pending = toPending(edge);
		if (pending.source === pending.target) continue;
		const key = `${pending.source}|${pending.target}`;
		const existing = byPair.get(key);
		if (!existing) {
			byPair.set(key, pending);
			continue;
		}

		const existingPriority = REL_PRIORITY[existing.rel];
		const nextPriority = REL_PRIORITY[pending.rel];
		if (
			nextPriority > existingPriority ||
			(nextPriority === existingPriority && pending.confidence > existing.confidence)
		) {
			byPair.set(key, pending);
		}
	}

	return [...byPair.values()].map((edge) => ({
		id: `${edge.source}|${edge.target}|${edge.rel}`,
		source: edge.source,
		target: edge.target,
		rel: edge.rel,
		field: edge.field,
		reason: edge.reason,
		confidence: edge.confidence
	}));
}

export function mergeIntentEdges(edges: PendingEdge[]): GraphLink[] {
	return mergeEdgeCandidates(edges, (edge) => edge);
}

export function mergeGraphLinks(links: GraphLink[]): GraphLink[] {
	return mergeEdgeCandidates(links, (edge) => ({
		source: edge.source,
		target: edge.target,
		rel: edge.rel,
		field: edge.field,
		reason: edge.reason ?? 'Inferred dependency',
		confidence: edge.confidence ?? MIN_CONFIDENCE
	}));
}

export function inferCatalogLinks(
	catalog: Map<string, CatalogEntry>,
	kindIndex: Map<string, string[]>
): GraphLink[] {
	const pending: PendingEdge[] = [];

	for (const entry of catalog.values()) {
		if (entry.type === 'state') {
			let configId: string | null = null;
			if (entry.kind.endsWith('State')) {
				const configKind = entry.kind.slice(0, -5);
				configId = resolveKindTarget(configKind, entry.group, kindIndex, catalog);
			}
			if (!configId) {
				configId =
					resolveNameSibling(entry.id, 'states', 's', catalog) ??
					resolveNameSibling(entry.id, 'states', '', catalog);
			}
			if (configId) {
				addPendingEdge(pending, {
					source: configId,
					target: entry.id,
					rel: 'observes',
					reason: 'Config/state catalog pairing',
					confidence: 100
				});
			}
		}

		if (entry.kind.endsWith('Deployment') || shortResourceName(entry.id).endsWith('deployments')) {
			let targetId: string | null = null;
			if (entry.kind.endsWith('Deployment')) {
				const targetKind = entry.kind.slice(0, -10);
				targetId = resolveKindTarget(targetKind, entry.group, kindIndex, catalog);
			}
			if (!targetId) {
				targetId =
					resolveNameSibling(entry.id, 'deployments', 's', catalog) ??
					resolveNameSibling(entry.id, 'deployments', '', catalog);
			}
			if (targetId) {
				addPendingEdge(pending, {
					source: entry.id,
					target: targetId,
					rel: 'deploys',
					reason: 'Deployment catalog pairing',
					confidence: 100
				});
			}
		}
	}

	return mergeIntentEdges(pending);
}

type SchemaZone = 'spec' | 'status' | 'metadata' | 'root';

function isStatusObservedStateNoise(intent: IntentMatch, zone: SchemaZone): boolean {
	if (zone !== 'status') return false;
	if (/operational state of the following resources/i.test(intent.reason)) return true;
	if (/Status tracks .+ operational state/i.test(intent.reason)) return true;
	if (intent.rel === 'references' && intent.confidence < 75) return true;
	return false;
}

export function inferSchemaLinks(
	sourceId: string,
	sourceGroup: string,
	specSchema: unknown,
	statusSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>,
	options?: {
		metadataSchema?: unknown;
		rootDescription?: string;
	}
): GraphLink[] {
	const pending: PendingEdge[] = [];

	const recordIntent = (intent: IntentMatch, path: string, zone: SchemaZone) => {
		if (isStatusObservedStateNoise(intent, zone)) return;
		const targetId = resolveKindTarget(intent.kind, sourceGroup, kindIndex, catalog);
		if (!targetId) return;
		const isPeerFabric =
			targetId === sourceId &&
			(path.includes('fabricSelectors') || /peer Fabric|connecting multiple Fabrics/i.test(intent.reason));
		if (targetId === sourceId && !isPeerFabric) return;
		addPendingEdge(
			pending,
			{
				source: sourceId,
				target: targetId,
				rel: intent.rel,
				field: path,
				reason: intent.reason,
				confidence: intent.confidence
			},
			isPeerFabric
		);
	};

	const handleProperty = (
		propName: string,
		description: string | undefined,
		path: string,
		zone: SchemaZone
	) => {
		if (propName === 'apiVersion' || propName === 'kind' || propName === 'metadata') return;

		for (const intent of extractIntentFromField(propName, description, path)) {
			recordIntent(intent, path, zone);
		}

		if (!description || zone === 'status') return;

		for (const intent of extractIntentFromDescription(description, path)) {
			recordIntent(intent, path, zone);
		}
	};

	const handleDescription = (description: string, path: string, zone: SchemaZone) => {
		if (zone === 'status') return;
		for (const intent of extractIntentFromDescription(description, path)) {
			recordIntent(intent, path, zone);
		}
	};

	if (options?.rootDescription) {
		handleDescription(options.rootDescription, 'schema', 'root');
	}

	for (const [schema, rootPath, zone] of [
		[options?.metadataSchema, 'metadata', 'metadata'],
		[specSchema, 'spec', 'spec'],
		[statusSchema, 'status', 'status']
	] as const) {
		if (!schema) continue;
		walkSchema(
			schema,
			rootPath,
			(propName, description, path) => handleProperty(propName, description, path, zone),
			(description, path) => handleDescription(description, path, zone)
		);
	}

	return mergeIntentEdges(pending);
}

export function buildCatalogFromManifest(resources: CrdResource[]): Map<string, CatalogEntry> {
	const catalog = new Map<string, CatalogEntry>();
	for (const res of resources) {
		catalog.set(res.name, {
			id: res.name,
			kind: res.kind || shortResourceName(res.name),
			group: res.group || res.name.split('.').slice(1).join('.'),
			type: classifyNodeType(res.name, res.kind || '')
		});
	}
	return catalog;
}

export function catalogToNodes(
	catalog: Map<string, CatalogEntry>,
	versions: Map<string, string>,
	descriptions: Map<string, string>
): GraphNode[] {
	return [...catalog.values()].map((entry) => ({
		id: entry.id,
		kind: entry.kind,
		group: entry.group,
		type: entry.type,
		version: versions.get(entry.id) ?? '',
		description: descriptions.get(entry.id),
		shortName: shortResourceName(entry.id)
	}));
}

export function getKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	return buildKindIndex(catalog);
}
