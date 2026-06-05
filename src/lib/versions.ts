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
	const versions = Array.isArray(resourceEntry)
		? resourceEntry
		: Array.isArray(resourceEntry?.versions)
			? resourceEntry.versions
			: [];
	const nonDeprecated = versions.filter((v) => v?.name && !v?.deprecated);
	const target = nonDeprecated.length > 0 ? nonDeprecated : versions.filter((v) => v?.name);
	const sorted = target.map((v) => v.name).sort(compareVersionDesc);
	return sorted[0] || '';
}
