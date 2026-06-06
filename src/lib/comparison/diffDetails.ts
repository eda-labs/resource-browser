export type DiffLineType = 'add' | 'remove' | 'modify' | 'neutral';
export type DiffSection = 'spec' | 'status' | 'other';

export type ParsedDiffLine = {
	type: DiffLineType;
	section: DiffSection;
	path: string;
	label: string;
	raw: string;
	before?: string;
	after?: string;
};

export type DiffViewRow = {
	lineNum: number;
	left: string | null;
	right: string | null;
	leftType: DiffLineType | null;
	rightType: DiffLineType | null;
};

function detectSection(path: string): DiffSection {
	if (path.startsWith('status.')) return 'status';
	if (path.startsWith('spec.')) return 'spec';
	return 'other';
}

export function parseDiffLine(detail: string): ParsedDiffLine {
	const raw = detail.trim();
	let type: DiffLineType = 'neutral';
	let path = raw;
	let label = raw;
	let before: string | undefined;
	let after: string | undefined;

	if (raw.startsWith('+')) {
		type = 'add';
		const m = raw.match(/^\+\s*(?:Added:\s*)?(.+)$/i);
		path = m?.[1]?.trim() ?? raw.slice(1).trim();
		label = `+ ${path}`;
	} else if (raw.startsWith('-')) {
		type = 'remove';
		const m = raw.match(/^-\s*(?:Removed:\s*)?(.+)$/i);
		path = m?.[1]?.trim() ?? raw.slice(1).trim();
		label = `− ${path}`;
	} else if (raw.startsWith('~')) {
		type = 'modify';
		const withValues = raw.match(/^~\s*(?:Modified:\s*)?(.+?) :: (.+) → (.+)$/);
		if (withValues) {
			path = withValues[1].trim();
			before = withValues[2].trim();
			after = withValues[3].trim();
			label = `~ ${path}`;
		} else {
			const m = raw.match(/^~\s*(?:Modified:\s*)?(.+)$/i);
			path = m?.[1]?.trim() ?? raw.slice(1).trim();
			label = `~ ${path}`;
		}
	}

	return {
		type,
		section: detectSection(path),
		path,
		label,
		raw,
		before,
		after
	};
}

export function groupDiffLines(details: string[]): Record<DiffSection, ParsedDiffLine[]> {
	const groups: Record<DiffSection, ParsedDiffLine[]> = {
		spec: [],
		status: [],
		other: []
	};
	for (const detail of details) {
		const parsed = parseDiffLine(detail);
		groups[parsed.section].push(parsed);
	}
	return groups;
}

export function buildSideBySideRows(lines: ParsedDiffLine[]): DiffViewRow[] {
	const rows: DiffViewRow[] = [];
	let lineNum = 1;
	for (const line of lines) {
		if (line.type === 'add') {
			rows.push({
				lineNum: lineNum++,
				left: null,
				right: line.path,
				leftType: null,
				rightType: 'add'
			});
		} else if (line.type === 'remove') {
			rows.push({
				lineNum: lineNum++,
				left: line.path,
				right: null,
				leftType: 'remove',
				rightType: null
			});
		} else if (line.type === 'modify') {
			rows.push({
				lineNum: lineNum++,
				left: line.path,
				right: line.path,
				leftType: 'modify',
				rightType: 'modify'
			});
		} else {
			rows.push({
				lineNum: lineNum++,
				left: line.label,
				right: line.label,
				leftType: 'neutral',
				rightType: 'neutral'
			});
		}
	}
	return rows;
}

export function diffLineClass(type: DiffLineType | null): string {
	if (type === 'add') return 'comparison-diff-cell comparison-diff-cell--add';
	if (type === 'remove') return 'comparison-diff-cell comparison-diff-cell--remove';
	if (type === 'modify') return 'comparison-diff-cell comparison-diff-cell--modify';
	return 'comparison-diff-cell comparison-diff-cell--neutral';
}
