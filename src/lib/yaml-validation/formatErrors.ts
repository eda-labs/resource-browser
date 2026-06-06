import type { ErrorObject } from 'ajv';
import type { EnrichedError, ValidationSummary } from './types';

export function formatVersionLabel(versionEntry: { name?: string; deprecated?: boolean }) {
	if (!versionEntry?.name) return '';
	return versionEntry.deprecated ? `${versionEntry.name} (deprecated)` : versionEntry.name;
}

export function getErrorTone(error: ErrorObject) {
	const msg = (error.message || '').toLowerCase();
	if (error.keyword === 'warning') {
		return {
			row: 'border border-yellow-200 bg-yellow-50/70 dark:border-yellow-800 dark:bg-yellow-900/20',
			icon: 'text-yellow-600 dark:text-yellow-400',
			text: 'text-yellow-900 dark:text-yellow-100',
			path: 'text-yellow-700 dark:text-yellow-300',
			iconType: 'warning' as const
		};
	}

	if (error.keyword === 'enum') {
		return {
			row: 'border border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-800 dark:bg-fuchsia-900/20',
			icon: 'text-fuchsia-600 dark:text-fuchsia-400',
			text: 'text-fuchsia-900 dark:text-fuchsia-100',
			path: 'text-fuchsia-700 dark:text-fuchsia-300',
			iconType: 'error' as const
		};
	}

	if (error.keyword === 'required') {
		return {
			row: 'border border-rose-200 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-900/20',
			icon: 'text-rose-600 dark:text-rose-400',
			text: 'text-rose-900 dark:text-rose-100',
			path: 'text-rose-700 dark:text-rose-300',
			iconType: 'error' as const
		};
	}

	if (error.keyword === 'const') {
		return {
			row: 'border border-sky-200 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-900/20',
			icon: 'text-sky-600 dark:text-sky-400',
			text: 'text-sky-900 dark:text-sky-100',
			path: 'text-sky-700 dark:text-sky-300',
			iconType: 'error' as const
		};
	}

	return {
		row: 'border border-red-200 bg-white/70 dark:border-red-800 dark:bg-black/20',
		icon: 'text-red-500 dark:text-red-400',
		text: 'text-red-900 dark:text-red-100',
		path: 'text-red-700 dark:text-red-300',
		iconType: 'error' as const
	};
}

export function extractDeprecatedValues(message: string) {
	const m = message.match(/Deprecated versions:\s*([^(]*)/i);
	return m ? m[1].trim() : '';
}

export function extractAllowedValues(message: string) {
	const m = message.match(/Allowed values:\s*([^(]*)/i);
	return m ? m[1].trim() : '';
}

export function hasDeprecatedFlag(message: string) {
	return /\bdeprecated\b/i.test(message);
}

export function extractLocationInfo(message: string): string | null {
	const m = message.match(/\(Line\s+(\d+)(?:,\s*column\s+(\d+))?\)/i) || message.match(/\bLine\s+(\d+)\b/i);
	if (!m) return null;
	return m[2] ? `Line ${m[1]}, column ${m[2]}` : `Line ${m[1]}`;
}

export function extractLineNumber(message: string): number | undefined {
	const m = message.match(/\(Line\s+(\d+)/i) || message.match(/\bLine\s+(\d+)\b/i);
	return m ? Number(m[1]) : undefined;
}

export function stripHighlightClauses(message: string) {
	return message
		.replace(/\.?\s*Allowed values:\s*[^(]*/i, '')
		.replace(/\.?\s*Deprecated versions:\s*[^(]*/i, '')
		.replace(/\s*\(Line\s+\d+(?:,\s*column\s+\d+)?\)/i, '')
		.trim();
}

export function getValueByPointer(data: unknown, pointer: string) {
	if (!pointer) return data;
	const parts = pointer.split('/').filter(Boolean);
	let current: unknown = data;
	for (const p of parts) {
		const key = p.replace(/~1/g, '/').replace(/~0/g, '~');
		if (current === null || current === undefined) return undefined;
		if (typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

export function docIndexFromMessage(message: string, totalDocs: number) {
	const m = message.match(/^\[Doc\s+(\d+)\]/i);
	if (m) return Number(m[1]);
	return totalDocs === 1 ? 1 : null;
}

export function buildSummary(totalDocs: number, errors: ErrorObject[], warnings: ErrorObject[]): ValidationSummary {
	const errorDocs = new Set<number>();
	const warningDocs = new Set<number>();

	for (const err of errors) {
		const idx = docIndexFromMessage(err.message || '', totalDocs);
		if (idx) errorDocs.add(idx);
	}

	for (const warn of warnings) {
		const idx = docIndexFromMessage(warn.message || '', totalDocs);
		if (idx) warningDocs.add(idx);
	}

	for (let i = 1; i <= totalDocs; i++) {
		if (errorDocs.has(i)) warningDocs.delete(i);
	}

	return {
		totalDocs,
		docsWithErrors: errorDocs.size,
		docsWithWarnings: warningDocs.size,
		validDocs: Math.max(totalDocs - errorDocs.size - warningDocs.size, 0),
		totalErrors: errors.length,
		totalWarnings: warnings.length
	};
}

export function isWarningEntry(error: ErrorObject) {
	return error.keyword === 'warning';
}

export function countErrors(items: ErrorObject[]) {
	return items.filter((item) => !isWarningEntry(item) && item.keyword !== 'success').length;
}

export function countWarnings(items: ErrorObject[]) {
	return items.filter((item) => isWarningEntry(item)).length;
}

export function formatErrorsForCopy(errors: EnrichedError[]): string {
	return errors
		.filter((e) => e.keyword !== 'success')
		.map((e) => stripHighlightClauses(e.message || ''))
		.join('\n');
}
