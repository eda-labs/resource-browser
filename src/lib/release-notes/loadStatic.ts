import type { ReleaseNotesEntry } from './types';

export type ReleaseNotesIndexEntry = {
	toVer: string;
	fromVer: string;
	source: 'comparison' | 'mock';
	timestamp: number;
};

export type ReleaseNotesIndex = {
	generatedAt: string;
	latest: string;
	entries: ReleaseNotesIndexEntry[];
};

export async function fetchReleaseNotesIndex(): Promise<ReleaseNotesIndex | null> {
	const resp = await fetch('/release-notes/index.json');
	if (!resp.ok) return null;
	return (await resp.json()) as ReleaseNotesIndex;
}

export async function fetchReleaseNotesEntry(toVer: string): Promise<ReleaseNotesEntry | null> {
	const resp = await fetch(`/release-notes/${encodeURIComponent(toVer)}.json`);
	if (!resp.ok) return null;
	return (await resp.json()) as ReleaseNotesEntry;
}

export async function fetchAllReleaseNotes(
	index: ReleaseNotesIndex
): Promise<ReleaseNotesEntry[]> {
	const results = await Promise.allSettled(
		index.entries.map((meta) => fetchReleaseNotesEntry(meta.toVer))
	);

	return results
		.filter(
			(r): r is PromiseFulfilledResult<ReleaseNotesEntry | null> => r.status === 'fulfilled'
		)
		.map((r) => r.value)
		.filter((entry): entry is ReleaseNotesEntry => entry !== null)
		.sort((a, b) => b.toVer.localeCompare(a.toVer, undefined, { numeric: true }));
}
