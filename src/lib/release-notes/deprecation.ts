import type { ManifestResource } from '$lib/manifest';
import { displayKind, displayGroup } from '$lib/resourceSearch';
import type { DeprecatedApiVersion, DeprecatedItem } from './types';

const REMOVED_IN_UNKNOWN = 'Next major release';

export function resolveResourceKind(resource: ManifestResource): string {
	return displayKind(resource);
}

export function resolveResourceGroup(resource: ManifestResource): string {
	return displayGroup(resource);
}

export function fullApiVersion(resource: ManifestResource, versionName: string): string {
	const group = resolveResourceGroup(resource);
	return `${group}/${versionName}`;
}

export function recommendedApiVersion(resource: ManifestResource): string | undefined {
	const stable = resource.versions?.filter((v) => !v.deprecated) ?? [];
	if (stable.length === 0) return undefined;
	return fullApiVersion(resource, stable[stable.length - 1].name);
}

export function buildDeprecationMigrationPath(
	resource: ManifestResource,
	recommended?: string
): string {
	const kind = resolveResourceKind(resource);
	if (recommended) {
		return `Update manifests to apiVersion ${recommended} (available in the catalog)`;
	}
	return `Adopt a non-deprecated apiVersion for ${kind} from the catalog`;
}

export function countDeprecatedApiVersions(items: DeprecatedItem[]): number {
	return items.reduce((n, item) => n + item.deprecatedVersions.length, 0);
}

export function countNewlyDeprecatedApiVersions(items: DeprecatedItem[]): number {
	return items.reduce(
		(n, item) => n + item.deprecatedVersions.filter((v) => v.newInRelease).length,
		0
	);
}

export function sortDeprecatedItems(items: DeprecatedItem[]): DeprecatedItem[] {
	return [...items].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function removedInLabel(version: DeprecatedApiVersion): string | undefined {
	if (version.removedInVersion && version.removedInVersion !== 'TBD') {
		return version.removedInVersion;
	}
	return REMOVED_IN_UNKNOWN;
}

export type RawDeprecatedVersion = {
	versionName: string;
	newInRelease: boolean;
};

export function groupDeprecatedByResource(
	resources: Array<{
		resource: ManifestResource;
		versions: RawDeprecatedVersion[];
	}>
): DeprecatedItem[] {
	const items: DeprecatedItem[] = [];

	for (const { resource, versions } of resources) {
		if (versions.length === 0) continue;

		const kind = resolveResourceKind(resource);
		const group = resolveResourceGroup(resource);
		const recommended = recommendedApiVersion(resource);

		items.push({
			kind,
			group,
			crdName: resource.name,
			recommendedApiVersion: recommended,
			migrationPath: buildDeprecationMigrationPath(resource, recommended),
			deprecatedVersions: versions.map(({ versionName, newInRelease }) => ({
				version: versionName,
				apiVersion: fullApiVersion(resource, versionName),
				removedInVersion: REMOVED_IN_UNKNOWN,
				newInRelease
			}))
		});
	}

	return sortDeprecatedItems(items);
}
