import { generateBulkDiffReport, loadCrdsForRelease, loadVersionsForRelease } from '$lib/comparison/diffEngine';
import { parseDiffLine } from '$lib/comparison/diffDetails';
import type { BulkDiffReport, CrdDiffEntry } from '$lib/comparison/types';
import { fetchManifest, type ManifestResource } from '$lib/manifest';
import type { CrdResource, EdaRelease } from '$lib/structure';
import {
	countNewlyDeprecatedApiVersions,
	groupDeprecatedByResource,
	type RawDeprecatedVersion
} from './deprecation';
import { generateMockNotes } from './mockNotes';
import type {
	BreakingChange,
	DeprecatedItem,
	FieldChange,
	FieldChangeType,
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

function pickDefaultVersion(versions: string[], preferred?: string): string {
	if (preferred && versions.includes(preferred)) return preferred;
	return versions.length > 0 ? versions[versions.length - 1] : '';
}

function computeUpgradeRisk(fromVer: string, toVer: string, breakingCount: number): UpgradeRisk {
	const base = (() => {
		const fromMajor = parseReleaseVersion(fromVer)[0];
		const toMajor = parseReleaseVersion(toVer)[0];
		if (fromMajor !== toMajor) return 'high' as UpgradeRisk;
		if (fromVer.split('.')[1] !== toVer.split('.')[1]) return 'medium' as UpgradeRisk;
		return 'low' as UpgradeRisk;
	})();
	if (breakingCount >= 5) return 'high';
	if (breakingCount >= 2 && base === 'low') return 'medium';
	return base;
}

function classifyChangeType(parsedType: 'add' | 'remove' | 'modify' | 'neutral', path: string): FieldChangeType {
	if (parsedType === 'add') {
		return path.includes('required') ? 'required_added' : 'optional_added';
	}
	if (parsedType === 'remove') return 'removed';
	if (parsedType === 'modify') return 'type_change';
	return 'added';
}

function fieldToHuman(field: string): string {
	const leaf = field.split('.').pop() ?? field;
	return leaf.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function networkBehaviorForChange(changeType: FieldChangeType, field: string, kind: string): string {
	const label = fieldToHuman(field.replace(/^spec\./, '').replace(/^status\./, 'status.'));
	switch (changeType) {
		case 'removed':
			return `${kind} manifests referencing ${field} must remove this field before apply.`;
		case 'required_added':
			return `${kind} resources without ${field} will fail reconciliation — add the field to existing manifests.`;
		case 'type_change':
			return `${label} on ${kind} changed type or structure; validate existing values against the new schema.`;
		case 'optional_added':
		case 'added':
			return `New optional field ${field} available on ${kind}; existing manifests remain valid.`;
		default:
			return `Field ${field} changed on ${kind} — review operational impact before upgrade.`;
	}
}

function crdApiVersion(crd: CrdDiffEntry | CrdResource, version: string): string {
	const group = 'group' in crd && crd.group ? crd.group : 'eda.nokia.com';
	return `${group}/${version}`;
}

function detailsToChanges(details: string[]): FieldChange[] {
	return details
		.filter((d) => !d.startsWith('Not ') && !d.startsWith('No schema') && !d.startsWith('Present'))
		.map((detail) => {
			const parsed = parseDiffLine(detail);
			const changeType = classifyChangeType(parsed.type, parsed.path);
			return {
				field: parsed.path,
				changeType,
				before: parsed.type === 'remove' || parsed.type === 'modify' ? 'previous value' : '',
				after: parsed.type === 'add' || parsed.type === 'modify' ? 'updated value' : '',
				networkBehavior: networkBehaviorForChange(changeType, parsed.path, '')
			};
		});
}

function isBreakingChangeType(changeType: FieldChangeType): boolean {
	return (
		changeType === 'removed' ||
		changeType === 'required_added' ||
		changeType === 'type_change' ||
		changeType === 'enum_removed'
	);
}

function buildBreakingChanges(modifiedResources: ModifiedResource[]): BreakingChange[] {
	const breaking: BreakingChange[] = [];
	for (const resource of modifiedResources) {
		for (const change of resource.changes) {
			if (!isBreakingChangeType(change.changeType)) continue;
			breaking.push({
				kind: resource.kind,
				field: change.field,
				description: change.networkBehavior || `${resource.kind} field ${change.field} changed (${change.changeType}).`,
				migrationSteps: [
					`Identify affected ${resource.kind} resources in your cluster`,
					`Update manifests to address ${change.field}`,
					`Validate against the target release schema before apply`
				],
				yamlBefore: `# ${resource.kind} — field ${change.field} (before)\nspec:\n  # ... existing manifest ...`,
				yamlAfter: `# ${resource.kind} — field ${change.field} (after)\nspec:\n  # ... updated manifest ...`
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

export function reportToReleaseNotes(
	report: BulkDiffReport,
	fromVer: string,
	toVer: string,
	targetVersion: string,
	crdMeta: CrdResource[],
	deprecated: DeprecatedItem[] = []
): ReleaseNotes {
	const crdByName = new Map(crdMeta.map((c) => [c.name, c]));

	const newResources: NewResource[] = [];
	const removedResources: RemovedResource[] = [];
	const modifiedResources: ModifiedResource[] = [];

	for (const entry of report.crds) {
		if (entry.name.includes('states')) continue;

		const meta = crdByName.get(entry.name);
		const kind = entry.kind || meta?.kind || entry.name;

		if (entry.status === 'added') {
			newResources.push({
				kind,
				apiVersion: meta ? crdApiVersion(meta, targetVersion) : `eda.nokia.com/${targetVersion}`,
				description: `New ${kind} CRD introduced in EDA ${toVer}.`
			});
			continue;
		}

		if (entry.status === 'removed') {
			removedResources.push({
				kind,
				apiVersion: meta ? crdApiVersion(meta, report.sourceVersion) : `eda.nokia.com/${report.sourceVersion}`,
				reason: `Removed from the EDA ${toVer} catalog — migrate or decommission existing ${kind} resources.`
			});
			continue;
		}

		if (entry.status === 'modified' && entry.hasDiff) {
			const changes = detailsToChanges(entry.details).map((c) => ({
				...c,
				networkBehavior: networkBehaviorForChange(c.changeType, c.field, kind)
			}));
			if (changes.length > 0) {
				modifiedResources.push({ kind, changes });
			}
		}
	}

	const breakingFromRemovals: BreakingChange[] = removedResources.map((r) => ({
		kind: r.kind,
		field: 'resource',
		description: r.reason,
		migrationSteps: [
			`Export existing ${r.kind} manifests`,
			`Plan migration to replacement CRDs or decommission`,
			`Remove ${r.kind} resources before upgrading`
		],
		yamlBefore: `# ${r.kind} resource\napiVersion: ${r.apiVersion}\nkind: ${r.kind}`,
		yamlAfter: '# Resource removed — delete or migrate before upgrade'
	}));

	const breakingChanges = [...breakingFromRemovals, ...buildBreakingChanges(modifiedResources)].slice(
		0,
		50
	);

	const upgradeRisk = computeUpgradeRisk(fromVer, toVer, breakingChanges.length);
	const modifiedFieldCount = modifiedResources.reduce((n, r) => n + r.changes.length, 0);

	const summary =
		`EDA ${toVer} changes ${newResources.length} new, ${removedResources.length} removed, and ${modifiedResources.length} modified CRDs compared to ${fromVer}.` +
		(breakingChanges.length > 0
			? ` ${breakingChanges.length} breaking change${breakingChanges.length !== 1 ? 's' : ''} require manifest updates.`
			: ' No breaking schema changes detected.');

	const operationalImpact =
		breakingChanges.length > 0
			? `Before upgrading to ${toVer}, validate all manifests affected by ${breakingChanges.length} breaking change(s). Run the bundle validator against the ${toVer} schema and schedule a maintenance window for controller restart.`
			: newResources.length > 0 || modifiedFieldCount > 0
				? `Release ${toVer} adds ${newResources.length} CRD(s) and ${modifiedFieldCount} field change(s). Existing manifests should apply cleanly; review new resources for adoption.`
				: `Release ${toVer} is a low-impact upgrade from ${fromVer} with no detected schema diffs.`;

	const upgradeChecklist = [
		`Run bundle validator against all manifests for ${toVer} schema`,
		...(breakingChanges.length > 0
			? [`Resolve ${breakingChanges.length} breaking change(s) in affected CRDs`]
			: []),
		...(newResources.length > 0 ? [`Review ${newResources.length} new CRD(s) for adoption`] : []),
		...(countNewlyDeprecatedApiVersions(deprecated) > 0
			? [`Migrate ${countNewlyDeprecatedApiVersions(deprecated)} newly deprecated API version(s)`]
			: []),
		'Stage upgrade in lab environment first',
		'Apply during a maintenance window'
	];

	const estimatedEffort =
		upgradeRisk === 'high' ? 'High: >4h' : upgradeRisk === 'medium' ? 'Medium: 1-4h' : 'Low: <1h';

	const upgradeRiskJustification =
		upgradeRisk === 'high'
			? `Upgrade from ${fromVer} to ${toVer} includes ${breakingChanges.length} breaking change(s) and/or cross-major schema shifts.`
			: upgradeRisk === 'medium'
				? `Minor release upgrade with ${modifiedResources.length} modified CRD(s) and ${breakingChanges.length} breaking field change(s).`
				: `Patch-level upgrade with ${breakingChanges.length} breaking change(s) — existing manifests likely apply cleanly.`;

	return {
		summary,
		newResources,
		removedResources,
		modifiedResources,
		deprecated,
		breakingChanges,
		operationalImpact,
		upgradeRisk,
		upgradeRiskJustification,
		upgradeChecklist,
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
		const [sourceVersions, targetVersions, crdMeta] = await Promise.all([
			loadVersionsForRelease(sourceRelease, manifestCache),
			loadVersionsForRelease(targetRelease, manifestCache),
			loadCrdsForRelease(sourceRelease, manifestCache)
		]);

		const sourceVersion = pickDefaultVersion(sourceVersions);
		const targetVersion = pickDefaultVersion(targetVersions);

		if (!sourceVersion || !targetVersion || crdMeta.length === 0) {
			throw new Error('Missing version or CRD metadata');
		}

		const [report, deprecated] = await Promise.all([
			generateBulkDiffReport({
				sourceRelease,
				targetRelease,
				sourceVersion,
				targetVersion,
				crdMeta,
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

		return {
			toVer,
			fromVer,
			notes: reportToReleaseNotes(report, fromVer, toVer, targetVersion, crdMeta, deprecated),
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
