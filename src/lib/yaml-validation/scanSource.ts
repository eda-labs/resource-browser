export type SourceValidationIssue = {
	message: string;
	line: number;
	column?: number;
	keyword: 'boolean-case';
};

const UNQUOTED_BOOL_VALUE = /:\s*(True|False|TRUE|FALSE)(\s*(?:#.*)?)$/;
const LIST_BOOL_VALUE = /^\s*-\s*(True|False|TRUE|FALSE)(\s*(?:#.*)?)$/;

function isQuotedBooleanValue(line: string, matchIndex: number): boolean {
	const before = line.slice(0, matchIndex);
	return /:\s*["']/.test(before);
}

/**
 * YAML 1.2 allows only lowercase unquoted `true` and `false`. js-yaml accepts
 * other casings via its default schema; scan source text to flag them as errors.
 */
export function scanInvalidBooleanLiterals(yamlInput: string): SourceValidationIssue[] {
	const issues: SourceValidationIssue[] = [];
	const lines = yamlInput.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const colonMatch = line.match(UNQUOTED_BOOL_VALUE);
		if (colonMatch && colonMatch.index !== undefined) {
			if (!isQuotedBooleanValue(line, colonMatch.index)) {
				const literal = colonMatch[1];
				const column = colonMatch.index + line.slice(colonMatch.index).indexOf(literal) + 1;
				issues.push({
					message: `Boolean must be lowercase true or false (found '${literal}')`,
					line: i + 1,
					column,
					keyword: 'boolean-case'
				});
				continue;
			}
		}

		const listMatch = line.match(LIST_BOOL_VALUE);
		if (listMatch) {
			const literal = listMatch[1];
			const column = line.indexOf(literal) + 1;
			issues.push({
				message: `Boolean must be lowercase true or false (found '${literal}')`,
				line: i + 1,
				column,
				keyword: 'boolean-case'
			});
		}
	}

	return issues;
}
