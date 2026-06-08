import { YAMLException } from 'js-yaml';
import { loadUserYaml } from '$lib/yaml/safeYaml';
import type { ParsedDocument, ParseDocumentsResult, ParseError } from './types';

export function formatYamlParseError(e: unknown): { message: string; line?: number; column?: number } {
	if (e instanceof YAMLException) {
		const line = e.mark?.line !== undefined ? e.mark.line + 1 : undefined;
		const column = e.mark?.column !== undefined ? e.mark.column + 1 : undefined;
		const location =
			line !== undefined
				? column !== undefined
					? ` at line ${line}, column ${column}`
					: ` at line ${line}`
				: '';
		return { message: `${e.reason}${location}`, line, column };
	}
	const message = e instanceof Error ? e.message : String(e);
	return { message };
}

/** Approximate per-document start lines for location hints (parsing uses loadAll). */
function findDocStartLines(input: string, docCount: number): number[] {
	if (docCount <= 1) return [0];
	const starts = [0];
	const lines = input.split('\n');
	let docIndex = 1;
	for (let i = 0; i < lines.length && docIndex < docCount; i++) {
		if (/^---\s*$/.test(lines[i]) && i > 0) {
			starts.push(i + 1);
			docIndex++;
		}
	}
	while (starts.length < docCount) {
		starts.push(starts[starts.length - 1] ?? 0);
	}
	return starts;
}

function extractDocRawTexts(input: string, docCount: number): string[] {
	if (docCount <= 1) return [input.trim()];
	const parts: string[] = [];
	const lines = input.split('\n');
	let current: string[] = [];

	for (const line of lines) {
		if (/^---\s*$/.test(line) && current.length > 0) {
			parts.push(current.join('\n'));
			current = [];
		} else if (/^---\s*$/.test(line) && current.length === 0) {
			continue;
		} else {
			current.push(line);
		}
	}
	if (current.some((l) => l.trim())) {
		parts.push(current.join('\n'));
	}
	while (parts.length < docCount) {
		parts.push('');
	}
	return parts.slice(0, docCount);
}

export function findLineForPointerInDoc(docText: string, pointer: string): number | undefined {
	const parts = pointer.split('/').filter(Boolean);
	if (parts.length === 0) return undefined;

	let key = parts[parts.length - 1];
	if (/^\d+$/.test(key) && parts.length > 1) {
		key = parts[parts.length - 2];
	}

	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const keyRegex = new RegExp(`^\\s*["']?${escapedKey}["']?\\s*:`, 'i');
	const lines = docText.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (keyRegex.test(lines[i])) return i;
	}
	return undefined;
}

function splitYamlDocumentSections(input: string): { text: string; startLine: number }[] {
	const lines = input.split('\n');
	const sections: { text: string; startLine: number }[] = [];
	let current: string[] = [];
	let startLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^---\s*$/.test(line) && current.length > 0) {
			sections.push({ text: current.join('\n'), startLine });
			current = [];
			startLine = i + 1;
		} else if (/^---\s*$/.test(line) && current.length === 0) {
			startLine = i + 1;
		} else {
			current.push(line);
		}
	}

	if (current.some((l) => l.trim()) || sections.length === 0) {
		sections.push({ text: current.join('\n'), startLine });
	}

	return sections;
}

function parseFailureResult(
	parseErrors: ParseError[],
	docs: ParsedDocument[]
): Extract<ParseDocumentsResult, { ok: false }> {
	const first = parseErrors[0];
	return {
		ok: false,
		message: first.message,
		line: first.line,
		column: first.column,
		docs,
		parseErrors
	};
}

export function parseDocuments(yamlInput: string): ParseDocumentsResult {
	const trimmed = yamlInput.trim();
	if (!trimmed) {
		return { ok: true, docs: [] };
	}

	const sections = splitYamlDocumentSections(trimmed);
	const docs: ParsedDocument[] = [];
	const parseErrors: ParseError[] = [];
	let docOrdinal = 0;

	for (const section of sections) {
		const sectionTrimmed = section.text.trim();
		if (!sectionTrimmed) continue;

		docOrdinal += 1;
		try {
			const data = loadUserYaml(sectionTrimmed);
			if (data === null || data === undefined) {
				parseErrors.push({
					message: 'Empty YAML document',
					docIndex: docOrdinal,
					line: section.startLine + 1
				});
				continue;
			}

			docs.push({
				data: data as Record<string, unknown>,
				rawText: sectionTrimmed,
				startLine: section.startLine,
				index: docs.length
			});
		} catch (e) {
			const { message, line, column } = formatYamlParseError(e);
			parseErrors.push({
				message: `YAML parsing error: ${message}`,
				docIndex: docOrdinal,
				line: line !== undefined ? section.startLine + line : section.startLine + 1,
				column
			});
		}
	}

	if (docs.length === 0 && parseErrors.length === 0) {
		return { ok: false, message: 'No valid YAML documents found' };
	}

	if (parseErrors.length > 0) {
		return parseFailureResult(parseErrors, docs);
	}

	return { ok: true, docs };
}

export function formatLocationInfo(line?: number, column?: number): string {
	if (line !== undefined) {
		const col = column !== undefined ? `, column ${column + 1}` : '';
		return ` (Line ${line + 1}${col})`;
	}
	return '';
}

export function getFieldLocationInfo(
	rawDoc: string,
	docStartLine: number,
	fieldPath: string
): string {
	const docRelativeLine = findLineForPointerInDoc(rawDoc, fieldPath);
	if (docRelativeLine !== undefined) {
		return formatLocationInfo(docStartLine + docRelativeLine, 0);
	}
	return '';
}
