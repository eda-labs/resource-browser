import { loadStaticYaml } from '$lib/yaml/safeYaml';
import {
	fetchManifest,
	loadCrdsForRelease as loadCrdsFromManifest,
	type ManifestResource
} from '$lib/manifest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { compareSchemas } from './schemaDiff';
import type { BulkDiffReport, CrdDiffEntry } from './types';

const BATCH_SIZE = 20;
const ALL_VERSIONS = 'all';

export async function loadVersionsForRelease(
	release: EdaRelease,
	manifestCache: Map<string, ManifestResource[]>
): Promise<string[]> {
	const manifest = await fetchManifest(release.folder, manifestCache);
	if (!manifest) return [];
	const versionSet = new Set<string>();
	for (const resource of manifest) {
		resource.versions?.forEach((v) => {
			if (v?.name) versionSet.add(v.name);
		});
	}
	return Array.from(versionSet).sort();
}

export async function loadCrdsForRelease(
	release: EdaRelease,
	manifestCache: Map<string, ManifestResource[]>
): Promise<CrdResource[]> {
	return loadCrdsFromManifest(release, manifestCache);
}

export function mergeCrdCatalogs(source: CrdResource[], target: CrdResource[]): CrdResource[] {
	const byName = new Map<string, CrdResource>();
	for (const crd of [...source, ...target]) {
		const existing = byName.get(crd.name);
		if (!existing) {
			byName.set(crd.name, crd);
			continue;
		}
		byName.set(crd.name, {
			...existing,
			kind: existing.kind || crd.kind,
			group: existing.group || crd.group
		});
	}
	return Array.from(byName.values());
}

function versionIndexFromManifest(manifest: ManifestResource[] | null): Map<string, string[]> {
	const index = new Map<string, string[]>();
	if (!manifest) return index;
	for (const resource of manifest) {
		const names = (resource.versions ?? []).map((v) => v.name).filter(Boolean);
		if (names.length > 0) index.set(resource.name, names);
	}
	return index;
}

function unionVersions(
	sourceVersions: string[],
	targetVersions: string[],
	versionFilter?: string
): string[] {
	const merged = new Set([...sourceVersions, ...targetVersions]);
	const sorted = Array.from(merged).sort();
	if (versionFilter) {
		return sorted.includes(versionFilter) ? [versionFilter] : [];
	}
	return sorted;
}

async function checkCrdInRelease(
	release: EdaRelease,
	resourceName: string,
	version: string,
	availabilityCache: Map<string, boolean>
): Promise<boolean> {
	const cacheKey = `${release.name}:${resourceName}:${version}`;
	if (availabilityCache.has(cacheKey)) {
		return availabilityCache.get(cacheKey)!;
	}
	try {
		const response = await fetch(`/${release.folder}/${resourceName}/${version}.yaml`, {
			method: 'HEAD',
			cache: 'force-cache'
		});
		const exists = response.ok;
		availabilityCache.set(cacheKey, exists);
		return exists;
	} catch {
		availabilityCache.set(cacheKey, false);
		return false;
	}
}

async function compareVersionPair(
	crd: CrdResource,
	version: string,
	sourceRelease: EdaRelease,
	targetRelease: EdaRelease,
	availabilityCache: Map<string, boolean>,
	yamlCache: Map<string, string>
): Promise<CrdDiffEntry> {
	const crdReport: CrdDiffEntry = {
		name: crd.name,
		kind: crd.kind,
		version,
		status: 'unchanged',
		hasDiff: false,
		details: []
	};

	const [sourceExists, targetExists] = await Promise.all([
		checkCrdInRelease(sourceRelease, crd.name, version, availabilityCache),
		checkCrdInRelease(targetRelease, crd.name, version, availabilityCache)
	]);

	if (!sourceExists && !targetExists) {
		crdReport.status = 'not-in-either';
		crdReport.details.push('Not available in either release');
		return crdReport;
	}

	if (!sourceExists) {
		crdReport.status = 'added';
		crdReport.hasDiff = true;
		crdReport.details.push(`API version ${version} present in target only`);
		return crdReport;
	}

	if (!targetExists) {
		crdReport.status = 'removed';
		crdReport.hasDiff = true;
		crdReport.details.push(`API version ${version} present in source only`);
		return crdReport;
	}

	const sourceKey = `/${sourceRelease.folder}/${crd.name}/${version}.yaml`;
	const targetKey = `/${targetRelease.folder}/${crd.name}/${version}.yaml`;

	let sourceYaml = yamlCache.get(sourceKey);
	if (!sourceYaml) {
		const sourceResponse = await fetch(sourceKey);
		if (!sourceResponse.ok) {
			crdReport.status = 'error';
			crdReport.details.push(`Failed to load source schema (${version})`);
			return crdReport;
		}
		sourceYaml = await sourceResponse.text();
		yamlCache.set(sourceKey, sourceYaml);
	}

	let targetYaml = yamlCache.get(targetKey);
	if (!targetYaml) {
		const targetResponse = await fetch(targetKey);
		if (!targetResponse.ok) {
			crdReport.status = 'error';
			crdReport.details.push(`Failed to load target schema (${version})`);
			return crdReport;
		}
		targetYaml = await targetResponse.text();
		yamlCache.set(targetKey, targetYaml);
	}

	const sourceData = loadStaticYaml(sourceYaml) as Record<string, unknown>;
	const targetData = loadStaticYaml(targetYaml) as Record<string, unknown>;
	const allChanges = compareSchemas(sourceData, targetData);
	if (allChanges.length > 0) {
		crdReport.status = 'modified';
		crdReport.hasDiff = true;
		crdReport.details = allChanges;
	} else {
		crdReport.status = 'unchanged';
		crdReport.details.push('No schema changes');
	}

	return crdReport;
}

export type GenerateDiffOptions = {
	sourceRelease: EdaRelease;
	targetRelease: EdaRelease;
	crdMeta?: CrdResource[];
	/** When set, only compare this apiVersion (paired by name across releases). */
	versionFilter?: string;
	manifestCache: Map<string, ManifestResource[]>;
	yamlCache: Map<string, string>;
	onProgress?: (percent: number, current: number, total: number) => void;
};

export async function generateBulkDiffReport(options: GenerateDiffOptions): Promise<BulkDiffReport> {
	const {
		sourceRelease,
		targetRelease,
		versionFilter,
		manifestCache,
		yamlCache,
		onProgress
	} = options;

	const [sourceManifest, targetManifest, sourceCrds, targetCrds] = await Promise.all([
		fetchManifest(sourceRelease.folder, manifestCache),
		fetchManifest(targetRelease.folder, manifestCache),
		options.crdMeta
			? Promise.resolve(options.crdMeta)
			: loadCrdsForRelease(sourceRelease, manifestCache),
		loadCrdsForRelease(targetRelease, manifestCache)
	]);

	const crdMeta = mergeCrdCatalogs(sourceCrds, targetCrds);
	const sourceVersionIndex = versionIndexFromManifest(sourceManifest);
	const targetVersionIndex = versionIndexFromManifest(targetManifest);

	const availabilityCache = new Map<string, boolean>();
	const reportVersion = versionFilter ?? ALL_VERSIONS;
	const report: BulkDiffReport = {
		sourceRelease: sourceRelease.label,
		sourceVersion: reportVersion,
		targetRelease: targetRelease.label,
		targetVersion: reportVersion,
		generatedAt: new Date().toISOString(),
		crds: []
	};

	const allCrds = crdMeta.filter((c) => !c.name.includes('states'));
	const workItems: Array<{ crd: CrdResource; version: string }> = [];

	for (const crd of allCrds) {
		const versions = unionVersions(
			sourceVersionIndex.get(crd.name) ?? [],
			targetVersionIndex.get(crd.name) ?? [],
			versionFilter
		);
		for (const version of versions) {
			workItems.push({ crd, version });
		}
	}

	const totalItems = workItems.length;
	const batches: Array<Array<{ crd: CrdResource; version: string }>> = [];
	for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
		batches.push(workItems.slice(i, i + BATCH_SIZE));
	}

	for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
		const batch = batches[batchIndex];
		const batchResults = await Promise.all(
			batch.map(async ({ crd, version }) => {
				try {
					return await compareVersionPair(
						crd,
						version,
						sourceRelease,
						targetRelease,
						availabilityCache,
						yamlCache
					);
				} catch {
					return {
						name: crd.name,
						kind: crd.kind,
						version,
						status: 'error' as const,
						hasDiff: false,
						details: [`Error comparing ${version} schemas`]
					};
				}
			})
		);

		report.crds.push(...batchResults);
		const processedSoFar = Math.min((batchIndex + 1) * BATCH_SIZE, totalItems);
		onProgress?.(
			totalItems > 0 ? Math.round((processedSoFar / totalItems) * 100) : 100,
			processedSoFar,
			totalItems
		);
	}

	return report;
}
