/**
 * Kubernetes-style API version ordering (alpha < beta < GA; higher major wins).
 * Matches static/merge-crds.py parse_k8s_api_version.
 */

const GA = /^v(\d+)$/;
const ALPHA = /^v(\d+)alpha(\d+)$/;
const BETA = /^v(\d+)beta(\d+)$/;

export type ApiVersionKey = [number, number, number | string];

export function parseK8sApiVersion(v: string): ApiVersionKey {
	let m = GA.exec(v);
	if (m) return [parseInt(m[1], 10), 2, 0];
	m = ALPHA.exec(v);
	if (m) return [parseInt(m[1], 10), 0, parseInt(m[2], 10)];
	m = BETA.exec(v);
	if (m) return [parseInt(m[1], 10), 1, parseInt(m[2], 10)];
	return [9999, 3, v];
}

function compareKeys(a: ApiVersionKey, b: ApiVersionKey): number {
	for (let i = 0; i < 3; i++) {
		const av = a[i];
		const bv = b[i];
		if (typeof av === 'string' || typeof bv === 'string') {
			const as = String(av);
			const bs = String(bv);
			if (as < bs) return -1;
			if (as > bs) return 1;
		} else {
			if (av < bv) return -1;
			if (av > bv) return 1;
		}
	}
	return 0;
}

/** Ascending order: oldest API version first (v1alpha1 before v1). */
export function compareK8sApiVersionAsc(a: string, b: string): number {
	return compareKeys(parseK8sApiVersion(a), parseK8sApiVersion(b));
}

/** Descending order: newest API version first (v2 before v1alpha1). */
export function sortApiVersionsNewestFirst(versions: string[]): string[] {
	return [...versions].sort((a, b) => compareK8sApiVersionAsc(b, a));
}

export function newestApiVersion(versions: string[]): string {
	const sorted = sortApiVersionsNewestFirst(versions);
	return sorted[0];
}
