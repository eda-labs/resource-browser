import type { CrdResource } from '$lib/structure';
import type { GraphLink, GraphNode, LinkRelation, NodeType } from './types';

type CatalogEntry = {
	id: string;
	kind: string;
	group: string;
	type: NodeType;
	description?: string;
};

const REF_PATTERNS: RegExp[] = [
	/Reference to (?:a|an) ([A-Z][A-Za-z0-9]+)/g,
	/List of ([A-Z][A-Za-z0-9]+) references?/gi,
	/([A-Z][A-Za-z0-9]+) resource(?:s)?(?:\s|$|[.,])/g,
	/([A-Z][A-Za-z0-9]+) CR(?:\s|$|[.,])/g,
	/Reference to ([A-Z][A-Za-z0-9]+)(?:\s|$|[.,])/g
];

function shortResourceName(name: string): string {
	return name.split('.')[0] ?? name;
}

export function classifyNodeType(name: string, kind: string): NodeType {
	const lower = name.toLowerCase();
	const short = shortResourceName(lower);
	if (
		kind.endsWith('State') ||
		short.endsWith('states') ||
		lower.includes('.states.')
	) {
		return 'state';
	}
	if (kind.endsWith('Deployment') || short.endsWith('deployments')) {
		return 'config';
	}
	return 'config';
}

function camelToKind(prop: string): string {
	if (!prop) return '';
	return prop.charAt(0).toUpperCase() + prop.slice(1);
}

function normalizeKindKey(kind: string): string {
	return kind.replace(/\s+/g, '').toLowerCase();
}

function buildKindIndex(catalog: Map<string, CatalogEntry>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const entry of catalog.values()) {
		if (!entry.kind) continue;
		const key = normalizeKindKey(entry.kind);
		const list = index.get(key) ?? [];
		list.push(entry.id);
		index.set(key, list);
	}
	return index;
}

function resolveKindTarget(
	kind: string,
	sourceGroup: string,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): string | null {
	const key = normalizeKindKey(kind);
	const candidates = kindIndex.get(key);
	if (!candidates?.length) return null;
	if (candidates.length === 1) return candidates[0];

	const sameGroup = candidates.filter((id) => catalog.get(id)?.group === sourceGroup);
	if (sameGroup.length === 1) return sameGroup[0];

	return candidates[0] ?? null;
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

function addLink(
	links: Map<string, GraphLink>,
	source: string,
	target: string,
	rel: LinkRelation,
	field?: string
): void {
	if (source === target) return;
	const id = `${source}|${target}|${rel}|${field ?? ''}`;
	if (links.has(id)) return;
	links.set(id, { id, source, target, rel, field });
}

function extractKindsFromDescription(description: string): string[] {
	const found = new Set<string>();
	for (const pattern of REF_PATTERNS) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(description)) !== null) {
			const kind = match[1];
			if (kind && kind.length > 2 && kind !== 'Node' && kind !== 'API') {
				found.add(kind);
			}
		}
	}
	return [...found];
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

export function inferCatalogLinks(
	catalog: Map<string, CatalogEntry>,
	kindIndex: Map<string, string[]>
): GraphLink[] {
	const links = new Map<string, GraphLink>();

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
				addLink(links, configId, entry.id, 'observes');
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
				addLink(links, entry.id, targetId, 'deploys');
			}
		}
	}

	return [...links.values()];
}

export function inferSchemaLinks(
	sourceId: string,
	sourceGroup: string,
	specSchema: unknown,
	statusSchema: unknown,
	kindIndex: Map<string, string[]>,
	catalog: Map<string, CatalogEntry>
): GraphLink[] {
	const links = new Map<string, GraphLink>();

	const handleReference = (targetKind: string, rel: LinkRelation, field?: string) => {
		const targetId = resolveKindTarget(targetKind, sourceGroup, kindIndex, catalog);
		if (targetId) addLink(links, sourceId, targetId, rel, field);
	};

	const handleProperty = (propName: string, description: string | undefined, path: string) => {
		if (propName === 'apiVersion' || propName === 'kind' || propName === 'metadata') return;

		const fromName = camelToKind(propName);
		handleReference(fromName, 'uses', path);

		if (description) {
			for (const kind of extractKindsFromDescription(description)) {
				handleReference(kind, 'references', path);
			}
		}
	};

	const handleDescription = (description: string, path: string) => {
		for (const kind of extractKindsFromDescription(description)) {
			handleReference(kind, 'references', path);
		}
	};

	for (const schema of [specSchema, statusSchema]) {
		if (schema) walkSchema(schema, 'spec', handleProperty, handleDescription);
	}

	return [...links.values()];
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
