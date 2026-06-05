import { getManifestCache } from './cache';
import type { ManifestResource } from './types';

export async function fetchManifest(
	releaseFolder: string,
	cache?: Map<string, ManifestResource[]>
): Promise<ManifestResource[] | null> {
	const store = cache ?? getManifestCache();
	if (store.has(releaseFolder)) {
		return store.get(releaseFolder)!;
	}
	const resp = await fetch(`/${releaseFolder}/manifest.json`);
	if (!resp.ok) return null;
	const manifest = (await resp.json()) as ManifestResource[];
	store.set(releaseFolder, manifest);
	return manifest;
}

/** Fire-and-forget manifest prefetch for a release folder. */
export function prefetchManifest(
	releaseFolder: string,
	cache?: Map<string, ManifestResource[]>
): void {
	const store = cache ?? getManifestCache();
	if (store.has(releaseFolder)) return;
	void fetch(`/${releaseFolder}/manifest.json`)
		.then((resp) => (resp.ok ? resp.json() : null))
		.then((manifest) => {
			if (manifest) store.set(releaseFolder, manifest as ManifestResource[]);
		})
		.catch(() => {
			/* ignore prefetch errors */
		});
}
