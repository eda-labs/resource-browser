import type { ErrorObject } from 'ajv';

function getValueByPointer(data: unknown, pointer: string): unknown {
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

function allowedValuesForError(err: ErrorObject): string[] | undefined {
	if (err.keyword === 'enum') {
		const values = err.params?.allowedValues;
		return Array.isArray(values) ? values.map(String) : undefined;
	}
	if (err.keyword === 'const') {
		const value = err.params?.allowedValue;
		return value !== undefined ? [String(value)] : undefined;
	}
	return undefined;
}

/**
 * Formats AJV enum/const mismatch messages with explicit case-sensitivity hints.
 */
export function formatValueConstraintError(
	err: ErrorObject,
	data: unknown,
	fieldLabel: string
): string {
	const allowed = allowedValuesForError(err);
	if (!allowed || allowed.length === 0) {
		return err.message || `${fieldLabel} has an invalid value`;
	}

	const providedValue = getValueByPointer(data, err.instancePath);
	const allowedText = allowed.join(', ');
	const constraint = `must be one of: ${allowedText} (exact case)`;

	if (providedValue !== undefined) {
		return `${fieldLabel}: value '${String(providedValue)}' is invalid; ${constraint}`;
	}

	return `${fieldLabel}: ${constraint}`;
}
