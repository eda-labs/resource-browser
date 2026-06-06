import { generateBulkDiffReport, loadCrdsForRelease } from '$lib/comparison/diffEngine';
import {
	detailsToFieldChanges,
	isManifestBreakingChange
} from '$lib/comparison/fieldChangeClassifier';
import type { BulkDiffReport, CrdDiffEntry } from '$lib/comparison/types';
import { fetchManifest, type ManifestResource } from '$lib/manifest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import { groupDeprecatedByResource, type RawDeprecatedVersion } from './deprecation';
import { generateMockNotes } from './mockNotes';
import type {
	BreakingChange,
	DeprecatedItem,
	FieldChange,
	ModifiedResource,
	NewResource,
	ReleaseNotes,
	ReleaseNotesEntry,
	RemovedResource,
	UpgradeRisk
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

function computeUpgradeRisk(fromVer: string, toVer: string, breakingCount: number): UpgradeRisk {
	const base = (() => {
		const fromMajor = parseReleaseVersion(fromVer)[0];
		const toMajor = parseReleaseVersion(toVer)[0];
		if (fromMajor !== toMajor) return 'high' as UpgradeRisk;
		if (fromVer.split('.')[1] !== toVer.split('.')[1]) return 'medium' as UpgradeRisk;
		return 'low' as UpgradeRisk;
	})();
	if (breakingCount >= 20) return 'high';
	if (breakingCount >= 5) return base === 'low' ? 'medium' : 'high';
	if (breakingCount >= 2 && base === 'low') return 'medium';
	return base;
}

function crdApiVersion(crd: CrdDiffEntry | CrdResource, version: string): string {
	const group = 'group' in crd && crd.group ? crd.group : 'eda.nokia.com';
	return `${group}/${version}`;
}

function yamlSnippetForField(kind: string, field: string, phase: 'before' | 'after'): string {
	const indent = field.startsWith('status.') ? 'status' : 'spec';
	const leaf = field.split('.').pop() ?? field;
	if (phase === 'before') {
		return `# ${kind} — ${field} (before)\n${indent}:\n  ${leaf}: <previous>`;
	}
	return `# ${kind} — ${field} (after)\n${indent}:\n  ${leaf}: <updated>`;
}

function buildBreakingChanges(
	removedResources: RemovedResource[],
	modifiedResources: ModifiedResource[]
): BreakingChange[] {
	const breaking: BreakingChange[] = [];

	for (const resource of removedResources) {
		breaking.push({
			kind: resource.kind,
			field: 'resource',
			description: resource.reason,
			severity: 'critical',
			migrationSteps: [
				`Export existing ${resource.kind} manifests`,
				`Plan migration to replacement CRDs or decommission`,
				`Remove ${resource.kind} resources before upgrading`
			],
			yamlBefore: `# ${resource.kind} resource\napiVersion: ${resource.apiVersion}\nkind: ${resource.kind}`,
			yamlAfter: '# Resource removed — delete or migrate before upgrade'
		});
	}

	for (const resource of modifiedResources) {
		for (const change of resource.changes) {
			if (!isManifestBreakingChange(change)) continue;
			const severity =
				change.changeType === 'removed' || change.changeType === 'required_added'
					? 'critical'
					: 'warning';
			breaking.push({
				kind: resource.kind,
				field: change.field,
				description:
					change.networkBehavior ||
					`${resource.kind} field ${change.field} changed (${change.changeType}).`,
				severity,
				migrationSteps: [
					`Identify affected ${resource.kind} resources in your cluster`,
					`Update manifests to address ${change.field}`,
					`Validate against the target release schema before apply`
				],
				yamlBefore:
					change.before ||
					yamlSnippetForField(resource.kind, change.field, 'before'),
				yamlAfter:
					change.after || yamlSnippetForField(resource.kind, change.field, 'after')
			});
		}
	}

	return breaking;
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

function crdExistedInSource(report: BulkDiffReport, crdName: string): boolean {
	return report.crds.some(
		(entry) =>
			entry.name === crdName &&
			(entry.status === 'removed' || entry.status === 'modified' || entry.status === 'unchanged')
	);
}

export function reportToReleaseNotes(
	report: BulkDiffReport,
	fromVer: string,
	toVer: string,
	crdMeta: CrdResource[],
	deprecated: DeprecatedItem[] = []
): ReleaseNotes {
	const crdByName = new Map(crdMeta.map((c) => [c.name, c]));

	const newResources: NewResource[] = [];
	const removedResources: RemovedResource[] = [];
	const modifiedResources: ModifiedResource[] = [];

	for (const entry of report.crds) {
		if (entry.name.includes('states')) continue;
		if (entry.status === 'not-in-either' || entry.status === 'error') continue;

		const meta = crdByName.get(entry.name);
		const kind = entry.kind || meta?.kind || entry.name;
		const apiVersion = meta ? crdApiVersion(meta, entry.version) : `eda.nokia.com/${entry.version}`;

		if (entry.status === 'added') {
			const existedInSource = crdExistedInSource(report, entry.name);
			newResources.push({
				kind,
				apiVersion,
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
			if (changes.length > 0) {
				modifiedResources.push({ kind, apiVersion, changes });
			}
		}
	}

	const breakingChanges = buildBreakingChanges(removedResources, modifiedResources);
	const totalBreakingCount = breakingChanges.length;
	const manifestBreakingFieldCount = modifiedResources.reduce(
		(n, r) => n + r.changes.filter((c) => isManifestBreakingChange(c)).length,
		0
	);

	const upgradeRisk = computeUpgradeRisk(fromVer, toVer, totalBreakingCount);

	const estimatedEffort =
		upgradeRisk === 'high' ? 'High: >4h' : upgradeRisk === 'medium' ? 'Medium: 1-4h' : 'Low: <1h';

	const upgradeRiskJustification =
		upgradeRisk === 'high'
			? `Upgrade from ${fromVer} to ${toVer} includes ${totalBreakingCount} breaking change(s)${removedResources.length > 0 ? ` including ${removedResources.length} removed CRD(s)` : ''}${manifestBreakingFieldCount > 0 ? ` and ${manifestBreakingFieldCount} spec field change(s)` : ''}.`
			: upgradeRisk === 'medium'
				? `Release upgrade with ${modifiedResources.length} modified CRD(s) and ${totalBreakingCount} breaking change(s).`
				: totalBreakingCount > 0
					? `Patch-level upgrade with ${totalBreakingCount} breaking change(s) — review affected manifests before apply.`
					: `Patch-level upgrade with no breaking manifest changes detected.`;

	return {
		newResources,
		removedResources,
		modifiedResources,
		deprecated,
		breakingChanges,
		totalBreakingCount,
		upgradeRisk,
		upgradeRiskJustification,
		estimatedEffort
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
			notes: reportToReleaseNotes(report, fromVer, toVer, crdMeta, deprecated),
			timestamp: Date.now(),
			source: 'comparison'
		};
	} catch {
		const mock = generateMockNotes(fromVer, toVer);
		return {
			toVer,
			fromVer,
			notes: { ...mock, totalBreakingCount: mock.breakingChanges.length },
			timestamp: Date.now(),
			source: 'mock'
		};
	}
}
