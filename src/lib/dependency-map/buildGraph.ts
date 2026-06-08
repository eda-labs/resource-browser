import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { fetchManifest, getManifestCache } from '$lib/manifest';
import type { ManifestResource } from '$lib/manifest';
import { getLatestVersion } from '$lib/versions';
import type { CrdResource, EdaRelease } from '$lib/structure';
import {
	buildCatalogFromManifest,
	catalogToNodes,
	getKindIndex,
	inferCatalogLinks,
	inferSchemaLinks,
	mergeGraphLinks
} from './inferEdges';
import type { BuildProgress, DependencyGraph } from './types';
import { extractSubgraph } from './transitiveClosure';

const FETCH_CONCURRENCY = 10;
const graphCache = new Map<string, DependencyGraph>();

type ParsedCrdSchema = {
	spec?: unknown;
	status?: unknown;
	metadata?: unknown;
	description?: string;
};

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadCrdSchema(
	releaseFolder: string,
	resourceName: string,
	version: string,
	yamlCache: Map<string, string>
): Promise<ParsedCrdSchema | null> {
	const cacheKey = `/${releaseFolder}/${resourceName}/${version}.yaml`;
	let txt = yamlCache.get(cacheKey);
	if (!txt) {
		const resp = await fetch(cacheKey);
		if (!resp.ok) return null;
		txt = await resp.text();
		yamlCache.set(cacheKey, txt);
	}

	try {
		const parsed = loadStaticYaml(txt) as {
			schema?: {
				openAPIV3Schema?: {
					description?: string;
					properties?: { spec?: unknown; status?: unknown; metadata?: unknown };
				};
			};
		};
		const root = parsed?.schema?.openAPIV3Schema;
		return {
			spec: root?.properties?.spec,
			status: root?.properties?.status,
			metadata: root?.properties?.metadata,
			description: root?.description
		};
	} catch {
		return null;
	}
}

async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await fn(items[i], i);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

export function resolveFocusNodeId(
	resources: CrdResource[],
	params: { resource?: string | null; kind?: string | null; group?: string | null }
): string | null {
	const { resource, kind, group } = params;

	if (kind && group) {
		const match = resources.find((r) => r.kind === kind && r.group === group);
		if (match) return match.name;
	}

	if (!resource) return null;

	const byName = resources.find((r) => r.name === resource);
	if (byName) return byName.name;

	const byKind = resources.filter((r) => r.kind === resource);
	if (byKind.length === 1) return byKind[0].name;
	if (byKind.length > 1 && group) {
		const match = byKind.find((r) => r.group === group);
		if (match) return match.name;
	}

	const lower = resource.toLowerCase();
	const byShort = resources.find(
		(r) =>
			r.name.split('.')[0].toLowerCase() === lower ||
			(r.kind && r.kind.toLowerCase() === lower)
	);
	return byShort?.name ?? null;
}

export function buildFocusSubgraph(
	graph: DependencyGraph,
	focusNodeId: string
): DependencyGraph | null {
	return extractSubgraph(graph, focusNodeId);
}

export function clearDependencyGraphCache(releaseFolder?: string): void {
	if (releaseFolder) graphCache.delete(releaseFolder);
	else graphCache.clear();
}

export async function buildDependencyGraph(
	release: EdaRelease,
	options?: {
		cache?: Map<string, ManifestResource[]>;
		yamlCache?: Map<string, string>;
		onProgress?: (progress: BuildProgress) => void;
		signal?: AbortSignal;
	}
): Promise<DependencyGraph> {
	const manifestCache = options?.cache ?? getManifestCache();
	const yamlCache = options?.yamlCache ?? new Map<string, string>();

	if (graphCache.has(release.folder)) {
		return graphCache.get(release.folder)!;
	}

	options?.onProgress?.({
		phase: 'manifest',
		current: 0,
		total: 1,
		message: 'Loading manifest…'
	});

	const manifest = await fetchManifest(release.folder, manifestCache);
	if (!manifest) {
		return {
			nodes: [],
			links: [],
			releaseFolder: release.folder,
			generatedAt: new Date().toISOString()
		};
	}

	const resources = manifest as CrdResource[];
	const catalog = buildCatalogFromManifest(resources);
	const kindIndex = getKindIndex(catalog);
	const versions = new Map<string, string>();
	const descriptions = new Map<string, string>();

	for (const res of resources) {
		versions.set(res.name, getLatestVersion(res));
	}

	const catalogLinks = inferCatalogLinks(catalog, kindIndex);
	const schemaLinks: typeof catalogLinks = [];
	const total = resources.length;

	options?.onProgress?.({
		phase: 'schemas',
		current: 0,
		total,
		message: 'Loading CRD schemas…'
	});

	let processed = 0;
	await mapConcurrent(resources, FETCH_CONCURRENCY, async (res) => {
		if (options?.signal?.aborted) return;

		const version = versions.get(res.name);
		if (!version) {
			processed++;
			return;
		}

		const parsed = await loadCrdSchema(release.folder, res.name, version, yamlCache);
		if (parsed?.description) {
			descriptions.set(res.name, parsed.description);
		}

		if (parsed?.spec || parsed?.status || parsed?.metadata || parsed?.description) {
			const entry = catalog.get(res.name);
			const group = entry?.group ?? res.group;
			const edges = inferSchemaLinks(
				res.name,
				group,
				parsed.spec,
				parsed.status,
				kindIndex,
				catalog,
				{
					metadataSchema: parsed.metadata,
					rootDescription: parsed.description
				}
			);
			schemaLinks.push(...edges);
		}

		processed++;
		if (processed % 8 === 0 || processed === total) {
			options?.onProgress?.({
				phase: 'schemas',
				current: processed,
				total,
				message: `Analyzing schemas (${processed}/${total})…`
			});
			await yieldToMain();
		}
	});

	if (options?.signal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}

	options?.onProgress?.({
		phase: 'edges',
		current: total,
		total,
		message: 'Building dependency graph…'
	});

	const graph: DependencyGraph = {
		nodes: catalogToNodes(catalog, versions, descriptions),
		links: mergeGraphLinks([...catalogLinks, ...schemaLinks]),
		releaseFolder: release.folder,
		generatedAt: new Date().toISOString()
	};

	graphCache.set(release.folder, graph);

	options?.onProgress?.({
		phase: 'done',
		current: total,
		total,
		message: 'Done'
	});

	return graph;
}

export { extractSubgraph } from './transitiveClosure';
