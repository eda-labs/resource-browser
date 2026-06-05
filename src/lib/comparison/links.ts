import type { CrdDiffEntry } from './types';

export function resourceDetailHref(
	crd: CrdDiffEntry,
	sourceReleaseName: string,
	targetReleaseName: string,
	sourceVersion: string,
	targetVersion: string
): string | null {
	if (crd.status === 'not-in-either' || crd.status === 'error') return null;

	const releaseName =
		crd.status === 'added' || crd.status === 'removed'
			? crd.status === 'added'
				? targetReleaseName
				: sourceReleaseName
			: sourceReleaseName;
	const version =
		crd.status === 'added'
			? targetVersion
			: crd.status === 'removed'
				? sourceVersion
				: sourceVersion;

	return `/${crd.name}/${version}?release=${encodeURIComponent(releaseName)}`;
}
