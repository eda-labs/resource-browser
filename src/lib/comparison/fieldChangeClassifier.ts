import { parseDiffLine, type ParsedDiffLine } from './diffDetails';
import type { FieldChange, FieldChangeType } from '$lib/release-notes/types';

const NOISE_PREFIXES = ['Not ', 'No schema', 'Present in', 'API version '];

/** OpenAPI / JSON Schema metadata segments — not user manifest fields. */
const SCHEMA_META_LEAVES = new Set([
	'description',
	'title',
	'example',
	'default',
	'format',
	'pattern',
	'nullable',
	'readOnly',
	'writeOnly',
	'deprecated',
	'externalDocs',
	'xml',
	'maximum',
	'minimum',
	'exclusiveMaximum',
	'exclusiveMinimum',
	'multipleOf',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'uniqueItems',
	'additionalProperties',
	'discriminator',
	'oneOf',
	'anyOf',
	'allOf',
	'not'
]);

export function isNoiseDiffDetail(detail: string): boolean {
	const trimmed = detail.trim();
	return NOISE_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function leafSegment(path: string): string {
	const segments = path.split('.');
	return segments[segments.length - 1] ?? path;
}

export function isSchemaMetadataPath(path: string): boolean {
	return SCHEMA_META_LEAVES.has(leafSegment(path));
}

export function classifyFieldChangeType(parsed: ParsedDiffLine): FieldChangeType {
	const { type, path } = parsed;

	if (type === 'add') {
		if (path.includes('.required') || leafSegment(path) === 'required') {
			return 'required_added';
		}
		return 'optional_added';
	}
	if (type === 'remove') {
		if (leafSegment(path) === 'enum') return 'enum_removed';
		return 'removed';
	}
	if (type === 'modify') {
		const leaf = leafSegment(path);
		if (leaf === 'enum') return 'enum_removed';
		if (leaf === 'default') return 'default_changed';
		return 'type_change';
	}
	return 'added';
}

export function isManifestBreakingChange(change: Pick<FieldChange, 'field' | 'changeType'>): boolean {
	const { field, changeType } = change;

	if (field.startsWith('status.')) return false;
	if (!field.startsWith('spec.') && changeType !== 'removed') return false;

	if (changeType === 'optional_added' || changeType === 'added' || changeType === 'enum_added') {
		return false;
	}
	if (changeType === 'default_changed') return false;

	if (changeType === 'removed' || changeType === 'required_added' || changeType === 'enum_removed') {
		return !isSchemaMetadataPath(field) || leafSegment(field) === 'enum';
	}

	if (changeType === 'type_change') {
		const leaf = leafSegment(field);
		if (leaf === 'type') return true;
		if (leaf === 'enum') return true;
		return !isSchemaMetadataPath(field);
	}

	return false;
}

export function fieldToHuman(field: string): string {
	const normalized = field.replace(/^spec\./, '').replace(/^status\./, 'status.');
	const leaf = normalized.split('.').pop() ?? normalized;
	return leaf.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function networkBehaviorForChange(
	changeType: FieldChangeType,
	field: string,
	kind: string
): string {
	const label = fieldToHuman(field);
	switch (changeType) {
		case 'removed':
			return `${kind} manifests referencing ${field} must remove this field before apply.`;
		case 'required_added':
			return `${kind} resources without ${field} will fail reconciliation — add the field to existing manifests.`;
		case 'type_change':
			return `${label} on ${kind} changed type or structure; validate existing values against the new schema.`;
		case 'enum_removed':
			return `${label} on ${kind} removed enum value(s); verify manifest values are still allowed.`;
		case 'default_changed':
			return `Default for ${field} on ${kind} changed; existing manifests without this field may behave differently.`;
		case 'optional_added':
		case 'added':
			return `New optional field ${field} available on ${kind}; existing manifests remain valid.`;
		default:
			return `Field ${field} changed on ${kind} — review operational impact before upgrade.`;
	}
}

export function detailToFieldChange(detail: string, kind: string): FieldChange | null {
	if (isNoiseDiffDetail(detail)) return null;

	const parsed = parseDiffLine(detail);
	const changeType = classifyFieldChangeType(parsed);

	return {
		field: parsed.path,
		changeType,
		before: parsed.before ?? (parsed.type === 'remove' || parsed.type === 'modify' ? '' : ''),
		after: parsed.after ?? (parsed.type === 'add' || parsed.type === 'modify' ? '' : ''),
		networkBehavior: networkBehaviorForChange(changeType, parsed.path, kind)
	};
}

export function detailsToFieldChanges(details: string[], kind: string): FieldChange[] {
	return details
		.map((detail) => detailToFieldChange(detail, kind))
		.filter((c): c is FieldChange => c !== null);
}
