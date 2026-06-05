export type DiffStatus =
	| 'added'
	| 'removed'
	| 'modified'
	| 'unchanged'
	| 'not-in-either'
	| 'error';

export type CrdDiffEntry = {
	name: string;
	kind: string;
	status: DiffStatus;
	hasDiff: boolean;
	details: string[];
};

export type BulkDiffReport = {
	sourceRelease: string;
	sourceVersion: string;
	targetRelease: string;
	targetVersion: string;
	generatedAt: string;
	crds: CrdDiffEntry[];
};
