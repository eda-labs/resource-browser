import type { CrdDiffEntry } from './types';

export type ResourceLinkContext = {
	releaseName: string;
	version: string;
};

export function resourceLinkContext(
	crd: CrdDiffEntry,
	sourceReleaseName: string,
	targetReleaseName: string
): ResourceLinkContext | null {
	if (crd.status === 'not-in-either' || crd.status === 'error') return null;

	const releaseName =
		crd.status === 'added' || crd.status === 'removed'
			? crd.status === 'added'
				? targetReleaseName
				: sourceReleaseName
			: sourceReleaseName;

	return { releaseName, version: crd.version };
}

export function resourceDetailHref(
	crd: CrdDiffEntry,
	sourceReleaseName: string,
	targetReleaseName: string
): string | null {
	const ctx = resourceLinkContext(crd, sourceReleaseName, targetReleaseName);
	if (!ctx) return null;
	return `/${crd.name}/${ctx.version}?release=${encodeURIComponent(ctx.releaseName)}`;
}
