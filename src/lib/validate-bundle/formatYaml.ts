import yaml from 'js-yaml';
import { parseDocuments } from '$lib/yaml-validation/parseDocuments';

const CRD_ROOT_ORDER = ['apiVersion', 'kind', 'metadata', 'spec', 'status'];
const METADATA_ORDER = [
	'name',
	'namespace',
	'labels',
	'annotations',
	'finalizers',
	'ownerReferences'
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortObjectKeys(
	obj: Record<string, unknown>,
	keyOrder?: readonly string[]
): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	const keys = Object.keys(obj);

	if (keyOrder) {
		for (const key of keyOrder) {
			if (key in obj) {
				sorted[key] = sortCrdKeys(obj[key], key);
			}
		}
		for (const key of keys) {
			if (!keyOrder.includes(key)) {
				sorted[key] = sortCrdKeys(obj[key], key);
			}
		}
		return sorted;
	}

	for (const key of keys) {
		sorted[key] = sortCrdKeys(obj[key], key);
	}
	return sorted;
}

/** Reorder keys on Kubernetes manifests to standard CRD layout; recurse nested values. */
export function sortCrdKeys(value: unknown, parentKey?: string): unknown {
	if (!isPlainObject(value)) {
		if (Array.isArray(value)) {
			return value.map((item) => sortCrdKeys(item));
		}
		return value;
	}

	if (parentKey === 'metadata') {
		return sortObjectKeys(value, METADATA_ORDER);
	}

	if ('apiVersion' in value && 'kind' in value) {
		return sortObjectKeys(value, CRD_ROOT_ORDER);
	}

	return sortObjectKeys(value);
}

export type FormatYamlResult =
	| { ok: true; formatted: string; docCount: number }
	| { ok: false; message: string };

/** Parse, sort CRD keys, and re-dump a multi-document YAML bundle. */
export function formatYamlBundle(yamlInput: string): FormatYamlResult {
	const trimmed = yamlInput.trim();
	if (!trimmed) {
		return { ok: false, message: 'Nothing to format' };
	}

	const parsed = parseDocuments(yamlInput);
	if (!parsed.ok) {
		return { ok: false, message: 'Cannot auto-fix: fix syntax first' };
	}

	if (parsed.docs.length === 0) {
		return { ok: false, message: 'Nothing to format' };
	}

	const formattedDocs = parsed.docs.map((doc) => {
		const sorted = sortCrdKeys(doc.data) as Record<string, unknown>;
		return yaml.dump(sorted, {
			indent: 2,
			lineWidth: -1,
			noRefs: true,
			sortKeys: false
		});
	});

	const formatted =
		formattedDocs.length === 1
			? formattedDocs[0].trimEnd() + '\n'
			: formattedDocs.map((doc) => doc.trimEnd()).join('\n---\n') + '\n';

	return { ok: true, formatted, docCount: parsed.docs.length };
}
