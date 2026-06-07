import { generateBulkDiffReport, loadCrdsForRelease } from '$lib/comparison/diffEngine';
import { detailsToFieldChanges, isSchemaMetadataPath } from '$lib/comparison/fieldChangeClassifier';
import type { BulkDiffReport, CrdDiffEntry } from '$lib/comparison/types';
import { fetchManifest, type ManifestResource } from '$lib/manifest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { groupDeprecatedByResource, type RawDeprecatedVersion } from './deprecation';
import { generateMockNotes } from './mockNotes';
import type {
	DeprecatedItem,
	FieldChange,
	ModifiedResource,
	NewResource,
	ReleaseNotes,
	ReleaseNotesEntry,
	RemovedResource
} from './types';

export function parseReleaseVersion(version: string): number[] {
	return version.split('.').map((part) => parseInt(part, 10) || 0);
}

export function compareReleaseDesc(a: string, b: string): number {
	const pa = parseReleaseVersion(a);
	const pb = parseReleaseVersion(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export function sortReleasesByVersion(releases: EdaRelease[]): EdaRelease[] {
	return [...releases].sort((a, b) => compareReleaseDesc(a.name, b.name));
}

export function buildConsecutivePairs(
	releases: EdaRelease[]
): Array<{ from: EdaRelease; to: EdaRelease }> {
	const sorted = sortReleasesByVersion(releases);
	const pairs: Array<{ from: EdaRelease; to: EdaRelease }> = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		pairs.push({ to: sorted[i], from: sorted[i + 1] });
	}
	return pairs;
}

function crdApiVersion(crd: CrdDiffEntry | CrdResource, version: string): string {
	const group = 'group' in crd && crd.group ? crd.group : 'eda.nokia.com';
	return `${group}/${version}`;
}

function isOperationalFieldChange(change: FieldChange): boolean {
	if (change.field.includes('x-kubernetes-')) return false;
	if (isSchemaMetadataPath(change.field)) return false;
	return change.field.startsWith('spec.');
}

function hasOperationalChanges(changes: FieldChange[]): boolean {
	return changes.some(isOperationalFieldChange);
}

async function findNewlyDeprecated(
	sourceRelease: EdaRelease,
	targetRelease: EdaRelease,
	manifestCache: Map<string, ManifestResource[]>
): Promise<DeprecatedItem[]> {
	const [sourceManifest, targetManifest] = await Promise.all([
		fetchManifest(sourceRelease.folder, manifestCache),
		fetchManifest(targetRelease.folder, manifestCache)
	]);
	if (!sourceManifest || !targetManifest) return [];

	const sourceDeprecated = new Set<string>();
	for (const resource of sourceManifest) {
		for (const v of resource.versions ?? []) {
			if (v.deprecated) sourceDeprecated.add(`${resource.name}:${v.name}`);
		}
	}

	const grouped = new Map<
		string,
		{ resource: ManifestResource; versions: RawDeprecatedVersion[] }
	>();

	for (const resource of targetManifest) {
		const newlyDeprecated: RawDeprecatedVersion[] = [];

		for (const v of resource.versions ?? []) {
			if (!v.deprecated) continue;
			const key = `${resource.name}:${v.name}`;
			if (!sourceDeprecated.has(key)) {
				newlyDeprecated.push({ versionName: v.name, newInRelease: true });
			}
		}

		if (newlyDeprecated.length === 0) continue;

		const allDeprecated: RawDeprecatedVersion[] = (resource.versions ?? [])
			.filter((v) => v.deprecated)
			.map((v) => ({
				versionName: v.name,
				newInRelease: !sourceDeprecated.has(`${resource.name}:${v.name}`)
			}));

		grouped.set(resource.name, { resource, versions: allDeprecated });
	}

	return groupDeprecatedByResource(Array.from(grouped.values()));
}

export function reportToReleaseNotes(
	report: BulkDiffReport,
	fromVer: string,
	toVer: string,
	crdMeta: CrdResource[],
	deprecated: DeprecatedItem[] = [],
	sourceCrds: CrdResource[] = []
): ReleaseNotes {
	const crdByName = new Map(crdMeta.map((c) => [c.name, c]));
	const sourceCrdNames = new Set(sourceCrds.map((c) => c.name));

	const newResources: NewResource[] = [];
	const removedResources: RemovedResource[] = [];
	const modifiedResources: ModifiedResource[] = [];

	for (const entry of report.crds) {
		if (entry.name.includes('states')) continue;
		if (entry.status === 'not-in-either' || entry.status === 'error') continue;

		const meta = crdByName.get(entry.name);
		const kind = entry.kind || meta?.kind || entry.name;
		const group = meta?.group;
		const apiVersion = meta ? crdApiVersion(meta, entry.version) : `eda.nokia.com/${entry.version}`;

		if (entry.status === 'added') {
			const existedInSource = sourceCrdNames.has(entry.name);
			newResources.push({
				kind,
				apiVersion,
				group,
				crdName: entry.name,
				description: existedInSource
					? `New ${apiVersion} apiVersion for ${kind} in EDA ${toVer}.`
					: `New ${kind} CRD introduced in EDA ${toVer} (${apiVersion}).`
			});
			continue;
		}

		if (entry.status === 'removed') {
			removedResources.push({
				kind,
				apiVersion,
				reason: `API version ${entry.version} removed from the EDA ${toVer} catalog — migrate or decommission existing ${kind} resources using ${apiVersion}.`
			});
			continue;
		}

		if (entry.status === 'modified' && entry.hasDiff) {
			const changes = detailsToFieldChanges(entry.details, kind);
			if (hasOperationalChanges(changes)) {
				modifiedResources.push({ kind, apiVersion, changes });
			}
		}
	}

	return {
		newResources,
		removedResources,
		modifiedResources,
		deprecated
	};
}

export type GenerateNotesOptions = {
	sourceRelease: EdaRelease;
	targetRelease: EdaRelease;
	manifestCache: Map<string, ManifestResource[]>;
	yamlCache: Map<string, string>;
	onProgress?: (percent: number) => void;
};

export async function generateReleaseNotesForPair(
	options: GenerateNotesOptions
): Promise<ReleaseNotesEntry> {
	const { sourceRelease, targetRelease, manifestCache, yamlCache, onProgress } = options;
	const fromVer = sourceRelease.name;
	const toVer = targetRelease.name;

	try {
		const [sourceCrds, targetCrds] = await Promise.all([
			loadCrdsForRelease(sourceRelease, manifestCache),
			loadCrdsForRelease(targetRelease, manifestCache)
		]);

		if (sourceCrds.length === 0 && targetCrds.length === 0) {
			throw new Error('Missing CRD metadata');
		}

		const [report, deprecated] = await Promise.all([
			generateBulkDiffReport({
				sourceRelease,
				targetRelease,
				manifestCache,
				yamlCache,
				onProgress: (pct) => onProgress?.(pct)
			}),
			findNewlyDeprecated(sourceRelease, targetRelease, manifestCache)
		]);

		const hasComparisonData = report.crds.some(
			(c) => c.status === 'added' || c.status === 'removed' || c.status === 'modified'
		);

		if (!hasComparisonData && report.crds.every((c) => c.status === 'error' || c.status === 'not-in-either')) {
			throw new Error('Comparison produced no usable data');
		}

		const crdMeta = [...sourceCrds, ...targetCrds].filter(
			(crd, index, all) => all.findIndex((c) => c.name === crd.name) === index
		);

		return {
			toVer,
			fromVer,
			notes: reportToReleaseNotes(report, fromVer, toVer, crdMeta, deprecated, sourceCrds),
			timestamp: Date.now(),
			source: 'comparison'
		};
	} catch {
		return {
			toVer,
			fromVer,
			notes: generateMockNotes(fromVer, toVer),
			timestamp: Date.now(),
			source: 'mock'
		};
	}
}
