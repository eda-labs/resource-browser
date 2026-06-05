import yaml from 'js-yaml';
import { fetchManifest, getManifestCache } from '$lib/manifest';
import type { ManifestResource } from '$lib/manifest';
import { getLatestVersion } from '$lib/versions';
import type { CrdResource, EdaRelease } from '$lib/structure';
import {
	buildCatalogFromManifest,
	catalogToNodes,
	getKindIndex,
	inferCatalogLinks,
	inferSchemaLinks
} from './inferEdges';
import type { BuildProgress, DependencyGraph } from './types';

const FETCH_CONCURRENCY = 10;
const graphCache = new Map<string, DependencyGraph>();

type ParsedCrdSchema = {
	spec?: unknown;
	status?: unknown;
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
		const parsed = yaml.load(txt) as {
			schema?: {
				openAPIV3Schema?: {
					description?: string;
					properties?: { spec?: unknown; status?: unknown };
				};
			};
		};
		const root = parsed?.schema?.openAPIV3Schema;
		return {
			spec: root?.properties?.spec,
			status: root?.properties?.status,
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

		if (parsed?.spec || parsed?.status) {
			const entry = catalog.get(res.name);
			const group = entry?.group ?? res.group;
			const edges = inferSchemaLinks(
				res.name,
				group,
				parsed.spec,
				parsed.status,
				kindIndex,
				catalog
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

	const linkMap = new Map<string, (typeof catalogLinks)[number]>();
	for (const link of [...catalogLinks, ...schemaLinks]) {
		linkMap.set(link.id, link);
	}

	const graph: DependencyGraph = {
		nodes: catalogToNodes(catalog, versions, descriptions),
		links: [...linkMap.values()],
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
