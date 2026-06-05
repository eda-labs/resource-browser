import yaml from 'js-yaml';
import type { ManifestResource } from '$lib/spec-search/searchEngine';
import { fetchManifest } from '$lib/spec-search/searchEngine';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { compareSchemas } from './schemaDiff';
import type { BulkDiffReport, CrdDiffEntry } from './types';

const BATCH_SIZE = 20;

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
	const manifest = await fetchManifest(release.folder, manifestCache);
	if (manifest) return manifest as CrdResource[];
	try {
		const res = await import('$lib/resources.yaml?raw');
		const resources = yaml.load(res.default) as Record<string, CrdResource[]>;
		return Object.values(resources).flat();
	} catch {
		return [];
	}
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

export type GenerateDiffOptions = {
	sourceRelease: EdaRelease;
	targetRelease: EdaRelease;
	sourceVersion: string;
	targetVersion: string;
	crdMeta: CrdResource[];
	manifestCache: Map<string, ManifestResource[]>;
	yamlCache: Map<string, string>;
	onProgress?: (percent: number, current: number, total: number) => void;
};

export async function generateBulkDiffReport(options: GenerateDiffOptions): Promise<BulkDiffReport> {
	const {
		sourceRelease,
		targetRelease,
		sourceVersion,
		targetVersion,
		crdMeta,
		yamlCache,
		onProgress
	} = options;

	const availabilityCache = new Map<string, boolean>();
	const report: BulkDiffReport = {
		sourceRelease: sourceRelease.label,
		sourceVersion,
		targetRelease: targetRelease.label,
		targetVersion,
		generatedAt: new Date().toISOString(),
		crds: []
	};

	const allCrds = crdMeta.filter((c) => !c.name.includes('states'));
	const totalCrds = allCrds.length;
	const batches: CrdResource[][] = [];
	for (let i = 0; i < allCrds.length; i += BATCH_SIZE) {
		batches.push(allCrds.slice(i, i + BATCH_SIZE));
	}

	for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
		const batch = batches[batchIndex];
		const batchResults = await Promise.all(
			batch.map(async (crd): Promise<CrdDiffEntry> => {
				try {
					const [sourceExists, targetExists] = await Promise.all([
						checkCrdInRelease(sourceRelease, crd.name, sourceVersion, availabilityCache),
						checkCrdInRelease(targetRelease, crd.name, targetVersion, availabilityCache)
					]);

					const crdReport: CrdDiffEntry = {
						name: crd.name,
						kind: crd.kind,
						status: 'unchanged',
						hasDiff: false,
						details: []
					};

					if (!sourceExists && !targetExists) {
						crdReport.status = 'not-in-either';
						crdReport.details.push('Not available in either release');
					} else if (!sourceExists) {
						crdReport.status = 'added';
						crdReport.hasDiff = true;
						crdReport.details.push('Present in target only');
					} else if (!targetExists) {
						crdReport.status = 'removed';
						crdReport.hasDiff = true;
						crdReport.details.push('Present in source only');
					} else {
						const sourceKey = `/${sourceRelease.folder}/${crd.name}/${sourceVersion}.yaml`;
						const targetKey = `/${targetRelease.folder}/${crd.name}/${targetVersion}.yaml`;

						let sourceYaml = yamlCache.get(sourceKey);
						if (!sourceYaml) {
							const sourceResponse = await fetch(sourceKey);
							if (!sourceResponse.ok) {
								crdReport.status = 'error';
								crdReport.details.push('Failed to load source schema');
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
								crdReport.details.push('Failed to load target schema');
								return crdReport;
							}
							targetYaml = await targetResponse.text();
							yamlCache.set(targetKey, targetYaml);
						}

						const sourceData = yaml.load(sourceYaml) as Record<string, unknown>;
						const targetData = yaml.load(targetYaml) as Record<string, unknown>;
						const allChanges = compareSchemas(sourceData, targetData);
						if (allChanges.length > 0) {
							crdReport.status = 'modified';
							crdReport.hasDiff = true;
							crdReport.details = allChanges;
						} else {
							crdReport.status = 'unchanged';
							crdReport.details.push('No schema changes');
						}
					}
					return crdReport;
				} catch {
					return {
						name: crd.name,
						kind: crd.kind,
						status: 'error',
						hasDiff: false,
						details: ['Error comparing schemas']
					};
				}
			})
		);

		report.crds.push(...batchResults);
		const processedSoFar = Math.min((batchIndex + 1) * BATCH_SIZE, totalCrds);
		onProgress?.(Math.round((processedSoFar / totalCrds) * 100), processedSoFar, totalCrds);
	}

	return report;
}
