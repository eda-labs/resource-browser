import { loadStaticYaml } from '$lib/yaml/safeYaml';
import type { CrdResource, CrdVersions, EdaRelease } from '$lib/structure';
import { fetchManifest } from './fetch';
import type { ManifestResource } from './types';

export async function loadVersionsForRelease(
	release: EdaRelease,
	cache?: Map<string, ManifestResource[]>
): Promise<string[]> {
	const manifest = await fetchManifest(release.folder, cache);
	if (!manifest) return [];
	const versionSet = new Set<string>();
	for (const resource of manifest) {
		resource.versions?.forEach((v) => {
			if (v?.name) versionSet.add(v.name);
		});
	}
	return Array.from(versionSet).sort();
}

export async function loadVersionsForResource(
	release: EdaRelease,
	resourceName: string,
	cache?: Map<string, ManifestResource[]>
): Promise<string[]> {
	const manifest = await fetchManifest(release.folder, cache);
	if (!manifest) return [];
	const resource = manifest.find((r) => r.name === resourceName);
	if (!resource?.versions) return [];
	return resource.versions.map((v) => v.name);
}

export async function fetchVersionsForResource(
	resourceName: string,
	release: EdaRelease,
	fallback: CrdVersions[] = [],
	cache?: Map<string, ManifestResource[]>
): Promise<CrdVersions[]> {
	const manifest = await fetchManifest(release.folder, cache);
	if (!manifest) return fallback;
	const entry = manifest.find((m) => m.name === resourceName);
	if (entry?.versions?.length) {
		return entry.versions.map((v) => ({
			name: v.name,
			deprecated: !!v.deprecated,
			appVersion: v.appVersion ?? ''
		}));
	}
	return fallback;
}

export async function loadCrdsForRelease(
	release: EdaRelease,
	cache?: Map<string, ManifestResource[]>
): Promise<CrdResource[]> {
	const manifest = await fetchManifest(release.folder, cache);
	if (manifest) return manifest as CrdResource[];

	try {
		const res = await import('$lib/resources.yaml?raw');
		const resources = loadStaticYaml(res.default) as Record<string, CrdResource[]>;
		return Object.values(resources).flat();
	} catch {
		return [];
	}
}
