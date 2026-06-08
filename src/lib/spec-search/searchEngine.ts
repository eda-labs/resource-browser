import { loadStaticYaml } from '$lib/yaml/safeYaml';
import {
	ensureRenderable,
	prepareMatchSchema,
	pruneSchema,
	stripDescriptions
} from './schemaUtils';

import type { ManifestResource } from '$lib/manifest';

export type { ManifestResource };

export type SearchMatch = {
	name: string;
	kind?: string;
	version?: string;
	type: 'spec' | 'status';
	schema: unknown;
	fullSpec?: unknown;
	fullStatus?: unknown;
};

export type ParsedResource = {
	spec?: unknown;
	status?: unknown;
};

export type SearchProgress = {
	matches: SearchMatch[];
	resourcesScanned: number;
	done: boolean;
};

export type SearchOptions = {
	releaseFolder: string;
	manifest: ManifestResource[];
	query: string;
	version: string;
	searchInDescription: boolean;
	maxResults: number;
	yamlCache: Map<string, string>;
	parsedCache: Map<string, ParsedResource>;
	isCancelled: () => boolean;
	onProgress?: (progress: SearchProgress) => void;
};

const FETCH_CONCURRENCY = 8;
const BATCH_YIELD_EVERY = 12;

function resourceKey(name: string, ver: string): string {
	return `${name}::${ver}`;
}

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadParsedResource(
	releaseFolder: string,
	resName: string,
	ver: string,
	yamlCache: Map<string, string>,
	parsedCache: Map<string, ParsedResource>
): Promise<ParsedResource | null> {
	const cacheKey = `/${releaseFolder}/${resName}/${ver}.yaml`;
	if (parsedCache.has(cacheKey)) {
		return parsedCache.get(cacheKey)!;
	}

	let txt = yamlCache.get(cacheKey);
	if (!txt) {
		const resp = await fetch(cacheKey);
		if (!resp.ok) return null;
		txt = await resp.text();
		yamlCache.set(cacheKey, txt);
	}

	try {
		const parsed = loadStaticYaml(txt) as {
			schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
		};
		const rawSpec = parsed?.schema?.openAPIV3Schema?.properties?.spec;
		const rawStatus = parsed?.schema?.openAPIV3Schema?.properties?.status;
		const entry: ParsedResource = {
			spec: rawSpec ? ensureRenderable(rawSpec) : undefined,
			status: rawStatus ? ensureRenderable(rawStatus) : undefined
		};
		parsedCache.set(cacheKey, entry);
		return entry;
	} catch {
		return null;
	}
}

function searchResourceVersion(
	res: ManifestResource,
	ver: string,
	parsed: ParsedResource,
	q: string,
	searchInDescription: boolean
): SearchMatch[] {
	const matches: SearchMatch[] = [];
	const { spec, status } = parsed;
	const fullSpec = spec;
	const fullStatus = status;

	if (spec && typeof spec === 'object') {
		const stripped = searchInDescription ? spec : stripDescriptions(spec);
		const pruned = pruneSchema(stripped, q, searchInDescription);
		if (pruned) {
			matches.push({
				name: res.name,
				kind: res.kind,
				version: ver,
				type: 'spec',
				schema: prepareMatchSchema(pruned as Record<string, unknown>, spec as Record<string, unknown>),
				fullSpec,
				fullStatus
			});
		}
	}

	if (status && typeof status === 'object') {
		const strippedStatus = searchInDescription ? status : stripDescriptions(status);
		const prunedStatus = pruneSchema(strippedStatus, q, searchInDescription);
		if (prunedStatus) {
			matches.push({
				name: res.name,
				kind: res.kind,
				version: ver,
				type: 'status',
				schema: prepareMatchSchema(
					prunedStatus as Record<string, unknown>,
					status as Record<string, unknown>
				),
				fullSpec,
				fullStatus
			});
		}
	}

	return matches;
}

type WorkItem = { res: ManifestResource; ver: string };

function buildWorkQueue(manifest: ManifestResource[], version: string): WorkItem[] {
	const queue: WorkItem[] = [];
	for (const res of manifest) {
		if (!res?.name || res.name.toLowerCase().includes('states')) continue;
		const versions = version
			? [version]
			: res.versions?.map((v) => v.name).filter(Boolean) ?? [];
		for (const ver of versions) {
			queue.push({ res, ver });
		}
	}
	return queue;
}

export async function searchManifest(options: SearchOptions): Promise<SearchMatch[]> {
	const {
		releaseFolder,
		manifest,
		query,
		version,
		searchInDescription,
		maxResults,
		yamlCache,
		parsedCache,
		isCancelled,
		onProgress
	} = options;

	const q = String(query ?? '').trim();
	if (!q) return [];

	const workQueue = buildWorkQueue(manifest, version);
	const matches: SearchMatch[] = [];
	const seenResources = new Set<string>();
	let resourcesScanned = 0;

	const emitProgress = (done: boolean) => {
		onProgress?.({ matches: [...matches], resourcesScanned, done });
	};

	for (let i = 0; i < workQueue.length; i += FETCH_CONCURRENCY) {
		if (isCancelled()) return matches;

		const batch = workQueue.slice(i, i + FETCH_CONCURRENCY);
		const batchResults = await Promise.all(
			batch.map(async ({ res, ver }) => {
				if (isCancelled()) return [] as SearchMatch[];
				const parsed = await loadParsedResource(
					releaseFolder,
					res.name,
					ver,
					yamlCache,
					parsedCache
				);
				if (!parsed) return [] as SearchMatch[];
				return searchResourceVersion(res, ver, parsed, q, searchInDescription);
			})
		);

		for (const resourceMatches of batchResults) {
			resourcesScanned++;
			for (const match of resourceMatches) {
				matches.push(match);
				seenResources.add(resourceKey(match.name, match.version ?? ''));
			}
			if (seenResources.size >= maxResults) {
				emitProgress(true);
				return matches;
			}
		}

		emitProgress(false);

		if ((i / FETCH_CONCURRENCY) % BATCH_YIELD_EVERY === 0) {
			await yieldToMain();
		}

		if (seenResources.size >= maxResults) break;
	}

	emitProgress(true);
	return matches;
}

export { fetchManifest } from '$lib/manifest';
