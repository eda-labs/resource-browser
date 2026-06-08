import type { ManifestEntry } from '$lib/yaml-validation/types';

/** Exact case-sensitive match on kind and apiVersion group. */
export function findManifestEntry(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find((r) => r.kind === kind && r.group === group);
}

/** Entry where group matches but kind differs only by case (Kubernetes kinds are case-sensitive). */
export function findManifestEntryCaseMismatch(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) => r.group === group && r.kind !== kind && r.kind.toLowerCase() === kind.toLowerCase()
	);
}

/** Entry where kind matches exactly and group differs only by case. */
export function findManifestEntryGroupCaseMismatch(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) =>
			r.kind === kind &&
			r.group &&
			r.group.toLowerCase() === group.toLowerCase() &&
			r.group !== group
	);
}

/** Entry where group matches case-insensitively and kind differs only by case. */
export function findManifestEntryKindCaseMismatchInsensitive(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	return manifest.find(
		(r) =>
			r.group &&
			r.group.toLowerCase() === group.toLowerCase() &&
			r.kind !== kind &&
			r.kind.toLowerCase() === kind.toLowerCase()
	);
}

/**
 * Unique manifest entry when kind and group match case-insensitively.
 * For auto-correction only — does not bypass strict validation.
 */
export function findManifestEntryCaseInsensitive(
	manifest: ManifestEntry[],
	kind: string,
	group: string
): ManifestEntry | undefined {
	if (!kind || !group) return undefined;
	const matches = manifest.filter(
		(r) =>
			r.kind &&
			r.group &&
			r.kind.toLowerCase() === kind.toLowerCase() &&
			r.group.toLowerCase() === group.toLowerCase()
	);
	return matches.length === 1 ? matches[0] : undefined;
}

export function findManifestEntriesByGroup(manifest: ManifestEntry[], group: string): ManifestEntry[] {
	if (!group) return [];
	return manifest.filter((r) => r.group === group);
}

export function findManifestEntriesByKind(manifest: ManifestEntry[], kind: string): ManifestEntry[] {
	if (!kind) return [];
	return manifest.filter((r) => r.kind === kind);
}

export function formatKindCaseMismatchMessage(expected: string, got: string): string {
	return `Invalid kind: '${got}' must be '${expected}' (Kubernetes kinds are case-sensitive).`;
}

export function formatInvalidApiVersionMessage(
	apiVersion: string,
	suggestedApiVersion: string,
	kind: string
): string {
	return `Invalid apiVersion: '${apiVersion}' is not defined for this release. Use '${suggestedApiVersion}' for kind ${kind}.`;
}

export function formatCrdNotFoundMessage(apiVersion: string, kind: string): string {
	return `Could not find CRD for apiVersion '${apiVersion}' and kind '${kind}'`;
}
