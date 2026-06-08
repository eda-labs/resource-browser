import type { CrdResource, CrdVersions } from '$lib/structure';

export function parseVersionName(versionName: string) {
	const m = /^v(\d+)(?:(alpha|beta)(\d+)?)?$/.exec(versionName || '');
	if (!m) {
		return { major: -1, stage: -1, stageNum: -1, raw: versionName };
	}

	const stage = m[2] === 'alpha' ? 1 : m[2] === 'beta' ? 2 : 3;
	const stageNum = Number(m[3] || 0);
	return { major: Number(m[1]), stage, stageNum, raw: versionName };
}

export function compareVersionDesc(a: string, b: string) {
	const pa = parseVersionName(a);
	const pb = parseVersionName(b);
	if (pa.major !== pb.major) return pb.major - pa.major;
	if (pa.stage !== pb.stage) return pb.stage - pa.stage;
	if (pa.stageNum !== pb.stageNum) return pb.stageNum - pa.stageNum;
	return pb.raw.localeCompare(pa.raw);
}

export function getLatestVersion(
	resourceEntry: Pick<CrdResource, 'versions'> | CrdVersions[] | null | undefined
): string {
	return pickLatestApiVersion(
		Array.isArray(resourceEntry)
			? resourceEntry
			: Array.isArray(resourceEntry?.versions)
				? resourceEntry.versions
				: []
	);
}

/** Pick the latest non-deprecated K8s apiVersion from manifest versions (v1 > v1beta1 > v1alpha1). */
export function pickLatestApiVersion(versions: CrdVersions[] | null | undefined): string {
	const list = Array.isArray(versions) ? versions : [];
	const nonDeprecated = list.filter((v) => v?.name && !v?.deprecated);
	const target = nonDeprecated.length > 0 ? nonDeprecated : list.filter((v) => v?.name);
	const sorted = target.map((v) => v.name).sort(compareVersionDesc);
	return sorted[0] || '';
}
