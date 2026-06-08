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

export function findManifestEntriesByGroup(manifest: ManifestEntry[], group: string): ManifestEntry[] {
	if (!group) return [];
	return manifest.filter((r) => r.group === group);
}

export function findManifestEntriesByKind(manifest: ManifestEntry[], kind: string): ManifestEntry[] {
	if (!kind) return [];
	return manifest.filter((r) => r.kind === kind);
}

export function formatKindCaseMismatchMessage(expected: string, got: string): string {
	return `kind must match CRD exactly: expected "${expected}", got "${got}"`;
}

export function formatCrdNotFoundMessage(apiVersion: string, kind: string): string {
	return `Could not find CRD for apiVersion '${apiVersion}' and kind '${kind}'`;
}
