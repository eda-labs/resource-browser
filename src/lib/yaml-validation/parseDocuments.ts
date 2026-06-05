import yaml, { YAMLException } from 'js-yaml';
import type { ParsedDocument, ParseDocumentsResult } from './types';

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

export function parseDocuments(yamlInput: string): ParseDocumentsResult {
	const trimmed = yamlInput.trim();
	if (!trimmed) {
		return { ok: true, docs: [] };
	}

	try {
		const parsed: unknown[] = [];
		yaml.loadAll(trimmed, (doc) => {
			if (doc !== null && doc !== undefined) {
				parsed.push(doc);
			}
		});

		if (parsed.length === 0) {
			return { ok: false, message: 'No valid YAML documents found' };
		}

		const startLines = findDocStartLines(trimmed, parsed.length);
		const rawTexts = extractDocRawTexts(trimmed, parsed.length);

		const docs: ParsedDocument[] = parsed.map((data, index) => ({
			data: data as Record<string, unknown>,
			rawText: rawTexts[index] || '',
			startLine: startLines[index] ?? 0,
			index
		}));

		return { ok: true, docs };
	} catch (e) {
		const { message, line, column } = formatYamlParseError(e);
		return { ok: false, message: `YAML parsing error: ${message}`, line, column };
	}
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
