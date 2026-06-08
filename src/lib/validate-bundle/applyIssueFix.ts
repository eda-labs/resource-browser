import { findLineForPointerInDoc, parseDocuments } from '$lib/yaml-validation/parseDocuments';
import type { BundleIssue, SuggestedFix, SuggestedFixField } from './types';

function fieldToYamlKey(field: SuggestedFixField): string {
	if (field === 'metadata.name') return 'name';
	if (field === 'metadata.namespace') return 'namespace';
	return field;
}

function fieldToPointer(field: SuggestedFixField): string {
	if (field === 'metadata.name') return '/metadata/name';
	if (field === 'metadata.namespace') return '/metadata/namespace';
	return `/${field}`;
}

function formatYamlScalar(value: string): string {
	if (/[:#{}[\],&*!|>'"%@`]|^\s|-\s|\s-$/.test(value)) {
		return `'${value.replace(/'/g, "''")}'`;
	}
	return value;
}

function replaceLineValue(line: string, yamlKey: string, newValue: string): string | null {
	const escaped = yamlKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = line.match(new RegExp(`^(\\s*["']?${escaped}["']?\\s*:\\s*)(.+?)\\s*$`));
	if (!match) return null;
	return `${match[1]}${formatYamlScalar(newValue)}`;
}

/** Apply a structured fix to yamlInput, returning updated YAML or null when not applicable. */
export function applySuggestedFix(yamlInput: string, issue: BundleIssue): string | null {
	const fix = issue.suggestedFix;
	if (!fix) return null;

	const parsed = parseDocuments(yamlInput);
	if (!parsed.ok || parsed.docs.length === 0) return null;

	const docIndex = issue.docIndex ?? 1;
	const doc = parsed.docs[docIndex - 1];
	if (!doc) return null;

	const yamlKey = fieldToYamlKey(fix.field);
	const lines = yamlInput.split('\n');

	let lineIndex: number | undefined;
	if (fix.line !== undefined) {
		lineIndex = fix.line - 1;
	} else if (issue.line !== undefined) {
		lineIndex = issue.line - 1;
	} else {
		const relLine = findLineForPointerInDoc(doc.rawText, fieldToPointer(fix.field));
		if (relLine !== undefined) {
			lineIndex = doc.startLine + relLine;
		}
	}

	if (lineIndex === undefined || lineIndex < 0 || lineIndex >= lines.length) {
		return null;
	}

	const updated = replaceLineValue(lines[lineIndex], yamlKey, fix.value);
	if (!updated) return null;

	lines[lineIndex] = updated;
	return lines.join('\n');
}
