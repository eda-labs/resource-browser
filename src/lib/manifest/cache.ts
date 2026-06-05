import type { ManifestResource } from './types';

const globalManifestCache = new Map<string, ManifestResource[]>();

/** Shared in-memory manifest cache (per release folder). */
export function getManifestCache(): Map<string, ManifestResource[]> {
	return globalManifestCache;
}

export function clearManifestCache(): void {
	globalManifestCache.clear();
}
