import yaml from 'js-yaml';
import { findManifestEntry, findManifestEntryCaseInsensitive } from '$lib/manifest/lookup';
import { getLatestVersion, pickLatestApiVersion } from '$lib/versions';
import { resolveObjectSchema } from '$lib/schema/requiredFields';
import { parseDocuments } from '$lib/yaml-validation/parseDocuments';
import { fixInvalidBooleanLiterals } from '$lib/yaml-validation/scanSource';
import { fetchSchemas, schemaPath } from '$lib/yaml-validation/schemaCache';
import { tryFixDnsLabel, tryFixDnsSubdomain } from './k8sRules';
import type { ManifestEntry } from '$lib/yaml-validation/types';
import type { SchemaSections } from '$lib/yaml-validation/schemaCache';

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

export type FixKind =
	| 'enumCase'
	| 'stringCoercion'
	| 'booleanCoercion'
	| 'dnsName'
	| 'apiVersionCase'
	| 'kindCase'
	| 'apiVersionUpgrade';

export type FixReport = {
	kind: FixKind;
	path: string;
	from: unknown;
	to: unknown;
	docIndex: number;
};

export type FormatYamlOptions = {
	releaseFolder: string;
	manifest: ManifestEntry[];
};

export type FormatYamlResult =
	| { ok: true; formatted: string; docCount: number; fixes: FixReport[] }
	| { ok: false; message: string };

function isObjectSchema(node: unknown): node is Record<string, unknown> {
	return !!node && typeof node === 'object' && !Array.isArray(node);
}

function getSchemaTypes(schema: unknown): string[] {
	if (!isObjectSchema(schema)) return [];
	if (typeof schema.type === 'string') return [schema.type];
	if (Array.isArray(schema.type)) {
		return schema.type.filter((t): t is string => typeof t === 'string');
	}
	return [];
}

function collectConstraints(schema: unknown): { types: string[]; enumValues: unknown[]; constValue: unknown } {
	const types = new Set<string>();
	const enumValues: unknown[] = [];
	let constValue: unknown;

	const visit = (node: unknown) => {
		if (!isObjectSchema(node)) return;
		for (const t of getSchemaTypes(node)) types.add(t);
		if (Array.isArray(node.enum)) enumValues.push(...node.enum);
		if ('const' in node) constValue = node.const;
		const branches = node.allOf;
		if (Array.isArray(branches)) {
			for (const branch of branches) visit(branch);
		}
	};

	visit(schema);
	return { types: [...types], enumValues, constValue };
}

function findUniqueCaseInsensitiveMatch(value: string, candidates: unknown[]): unknown | null {
	const matches = candidates.filter(
		(c) => typeof c === 'string' && c.toLowerCase() === value.toLowerCase()
	);
	if (matches.length !== 1) return null;
	return matches[0];
}

function tryFixLeaf(
	value: unknown,
	schema: unknown,
	path: string,
	docIndex: number,
	fixes: FixReport[]
): unknown {
	if (schema === null || schema === undefined) return value;

	const { types, enumValues, constValue } = collectConstraints(schema);
	let result = value;

	if (typeof result === 'string') {
		if (enumValues.length > 0) {
			const match = findUniqueCaseInsensitiveMatch(result, enumValues);
			if (match !== null && match !== result) {
				fixes.push({ kind: 'enumCase', path, from: result, to: match, docIndex });
				result = match;
			}
		} else if (constValue !== undefined && typeof constValue === 'string') {
			const match = findUniqueCaseInsensitiveMatch(result, [constValue]);
			if (match !== null && match !== result) {
				fixes.push({ kind: 'enumCase', path, from: result, to: match, docIndex });
				result = match;
			}
		}
	}

	if (types.includes('string') && typeof result === 'number' && Number.isFinite(result)) {
		const coerced = String(result);
		fixes.push({ kind: 'stringCoercion', path, from: result, to: coerced, docIndex });
		result = coerced;
	}

	if (types.includes('boolean') && typeof result === 'string') {
		const lower = result.toLowerCase();
		if (lower === 'true' || lower === 'false') {
			const coerced = lower === 'true';
			if (result !== lower) {
				fixes.push({ kind: 'booleanCoercion', path, from: result, to: coerced, docIndex });
			}
			result = coerced;
		}
	}

	return result;
}

function getItemsSchema(schema: unknown): unknown {
	if (!isObjectSchema(schema)) return null;
	if (schema.items) return schema.items;
	return resolveObjectSchema(schema);
}

function walkAndFix(
	data: unknown,
	schema: unknown,
	path: string,
	docIndex: number,
	fixes: FixReport[]
): unknown {
	if (data === null || data === undefined) return data;

	if (Array.isArray(data)) {
		const itemsSchema = getItemsSchema(schema);
		return data.map((item, i) =>
			walkAndFix(item, itemsSchema, path ? `${path}[${i}]` : `[${i}]`, docIndex, fixes)
		);
	}

	if (typeof data === 'object') {
		const resolved = resolveObjectSchema(schema);
		if (!resolved) return data;
		const record = data as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(record)) {
			if (value === undefined) continue;
			const propSchema = resolved.properties[key] ?? null;
			const childPath = path ? `${path}.${key}` : key;
			out[key] = walkAndFix(value, propSchema, childPath, docIndex, fixes);
		}
		return out;
	}

	return tryFixLeaf(data, schema, path, docIndex, fixes);
}

/** Apply schema-driven auto-fixes to a single manifest document. */
export function fixDocumentData(
	data: Record<string, unknown>,
	sections: SchemaSections,
	docIndex: number
): { data: Record<string, unknown>; fixes: FixReport[] } {
	const fixes: FixReport[] = [];
	const out = { ...data };

	if (sections.spec && out.spec !== undefined) {
		out.spec = walkAndFix(out.spec, sections.spec, 'spec', docIndex, fixes);
	}
	if (sections.status && out.status !== undefined) {
		out.status = walkAndFix(out.status, sections.status, 'status', docIndex, fixes);
	}

	const metadataSchema = resolveObjectSchema(sections.topLevel)?.properties?.metadata;
	if (metadataSchema && out.metadata !== undefined) {
		out.metadata = walkAndFix(out.metadata, metadataSchema, 'metadata', docIndex, fixes);
	}

	return { data: out, fixes };
}

/** Normalize apiVersion group and kind casing to manifest canonical values. */
export function fixManifestIdentity(
	data: Record<string, unknown>,
	manifest: ManifestEntry[],
	docIndex: number
): { data: Record<string, unknown>; fixes: FixReport[] } {
	const fixes: FixReport[] = [];
	const apiVersion = String(data.apiVersion || '');
	const kind = String(data.kind || '');
	if (!apiVersion || !kind || !manifest.length) {
		return { data, fixes };
	}

	const parts = apiVersion.split('/');
	if (parts.length !== 2) return { data, fixes };
	const [group, version] = parts;

	const entry = findManifestEntryCaseInsensitive(manifest, kind, group);
	if (!entry?.group || !entry.kind) return { data, fixes };

	const out = { ...data };
	const canonicalApiVersion = `${entry.group}/${version}`;

	if (out.kind !== entry.kind) {
		fixes.push({ kind: 'kindCase', path: 'kind', from: out.kind, to: entry.kind, docIndex });
		out.kind = entry.kind;
	}
	if (String(out.apiVersion) !== canonicalApiVersion) {
		fixes.push({
			kind: 'apiVersionCase',
			path: 'apiVersion',
			from: out.apiVersion,
			to: canonicalApiVersion,
			docIndex
		});
		out.apiVersion = canonicalApiVersion;
	}

	return { data: out, fixes };
}

/** Upgrade apiVersion to the latest manifest version when a newer one exists. */
export function fixApiVersionUpgrade(
	data: Record<string, unknown>,
	manifest: ManifestEntry[],
	docIndex: number
): { data: Record<string, unknown>; fixes: FixReport[] } {
	const fixes: FixReport[] = [];
	const apiVersion = String(data.apiVersion || '');
	const kind = String(data.kind || '');
	if (!apiVersion || !kind || !manifest.length) {
		return { data, fixes };
	}

	const parts = apiVersion.split('/');
	if (parts.length !== 2) return { data, fixes };
	const [group, currentVersion] = parts;

	const entry = findManifestEntryCaseInsensitive(manifest, kind, group);
	if (!entry?.group || !entry.versions?.length) return { data, fixes };

	const latestVersion = pickLatestApiVersion(entry.versions);
	if (!latestVersion || latestVersion === currentVersion) return { data, fixes };

	const out = { ...data };
	const upgradedApiVersion = `${entry.group}/${latestVersion}`;
	fixes.push({
		kind: 'apiVersionUpgrade',
		path: 'apiVersion',
		from: out.apiVersion,
		to: upgradedApiVersion,
		docIndex
	});
	out.apiVersion = upgradedApiVersion;

	return { data: out, fixes };
}

/** Apply fixable Kubernetes metadata rules (DNS name/namespace). */
export function fixK8sMetadata(
	data: Record<string, unknown>,
	docIndex: number
): { data: Record<string, unknown>; fixes: FixReport[] } {
	const fixes: FixReport[] = [];
	const metadata = data.metadata;
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		return { data, fixes };
	}

	const meta = { ...(metadata as Record<string, unknown>) };

	const name = meta.name;
	if (typeof name === 'string') {
		const fixed = tryFixDnsSubdomain(name);
		if (fixed !== null) {
			fixes.push({ kind: 'dnsName', path: 'metadata.name', from: name, to: fixed, docIndex });
			meta.name = fixed;
		}
	}

	const namespace = meta.namespace;
	if (typeof namespace === 'string') {
		const fixed = tryFixDnsLabel(namespace);
		if (fixed !== null) {
			fixes.push({
				kind: 'dnsName',
				path: 'metadata.namespace',
				from: namespace,
				to: fixed,
				docIndex
			});
			meta.namespace = fixed;
		}
	}

	return { data: { ...data, metadata: meta }, fixes };
}

function resolveSchemaForDoc(
	doc: Record<string, unknown>,
	manifest: ManifestEntry[],
	releaseFolder: string,
	schemas: Map<string, SchemaSections>
): SchemaSections | null {
	const apiVersion = String(doc.apiVersion || '');
	const kind = String(doc.kind || '');
	if (!apiVersion || !kind) return null;

	const parts = apiVersion.split('/');
	if (parts.length !== 2) return null;

	const [group] = parts;
	const entry = findManifestEntry(manifest, kind, group);
	if (!entry) return null;

	const latestVersion = getLatestVersion(entry);
	if (!latestVersion) return null;

	const key = schemaPath(releaseFolder, entry.name, latestVersion);
	return schemas.get(key) ?? null;
}

type FixableDoc = { data: Record<string, unknown>; index: number };

/** Parse documents and apply schema-driven fixes where CRD schemas are available. */
export async function fixYamlDocuments(
	docs: FixableDoc[],
	options: FormatYamlOptions
): Promise<FixReport[]> {
	const { releaseFolder, manifest } = options;
	const schemaPaths: string[] = [];

	for (const doc of docs) {
		const apiVersion = String(doc.data.apiVersion || '');
		const kind = String(doc.data.kind || '');
		if (!apiVersion || !kind) continue;
		const parts = apiVersion.split('/');
		if (parts.length !== 2) continue;
		const [group] = parts;
		const entry = findManifestEntry(manifest, kind, group);
		if (!entry) continue;
		const latestVersion = getLatestVersion(entry);
		if (latestVersion) {
			schemaPaths.push(schemaPath(releaseFolder, entry.name, latestVersion));
		}
	}

	const schemas = await fetchSchemas(schemaPaths);
	const allFixes: FixReport[] = [];

	for (const doc of docs) {
		const sections = resolveSchemaForDoc(doc.data, manifest, releaseFolder, schemas);
		if (!sections) continue;
		const { data, fixes } = fixDocumentData(doc.data, sections, doc.index + 1);
		doc.data = data;
		allFixes.push(...fixes);
	}

	return allFixes;
}

export type FixSummaryItem = {
	kind: FixKind;
	label: string;
	count: number;
	examples?: string[];
};

export type FixSummary = {
	docCount: number;
	layoutOnly: boolean;
	headline: string;
	items: FixSummaryItem[];
};

const FIX_KIND_ORDER: FixKind[] = [
	'apiVersionUpgrade',
	'kindCase',
	'apiVersionCase',
	'dnsName',
	'enumCase',
	'booleanCoercion',
	'stringCoercion'
];

function fixExample(fix: FixReport): string {
	return `${String(fix.from)} → ${String(fix.to)}`;
}

function buildFixItemLabel(kind: FixKind, count: number, examples: string[]): string {
	switch (kind) {
		case 'apiVersionUpgrade':
			return count === 1
				? `Upgraded apiVersion: ${examples[0]}`
				: `Upgraded apiVersion on ${count} documents`;
		case 'kindCase':
			return count === 1 ? `Fixed kind case: ${examples[0]}` : `Fixed ${count} kind cases`;
		case 'apiVersionCase':
			return count === 1
				? `Fixed apiVersion case: ${examples[0]}`
				: `Fixed ${count} apiVersion cases`;
		case 'dnsName':
			return count === 1 ? `Fixed DNS name: ${examples[0]}` : `Fixed ${count} DNS names`;
		case 'enumCase':
			return count === 1 ? `Fixed enum case: ${examples[0]}` : `Fixed ${count} enum cases`;
		case 'booleanCoercion':
			return count === 1 ? `Fixed boolean: ${examples[0]}` : `Fixed ${count} booleans`;
		case 'stringCoercion':
			return count === 1
				? `Coerced string: ${examples[0]}`
				: `Coerced ${count} values to strings`;
	}
}

/** Build a structured summary of auto-fixes applied during format. */
export function formatFixSummary(fixes: FixReport[], docCount: number): FixSummary {
	const docWord = docCount === 1 ? 'document' : 'documents';

	if (fixes.length === 0) {
		return {
			docCount,
			layoutOnly: true,
			headline: `Formatted ${docCount} ${docWord} (layout only)`,
			items: []
		};
	}

	const grouped = new Map<FixKind, { count: number; examples: string[] }>();
	for (const fix of fixes) {
		const entry = grouped.get(fix.kind) ?? { count: 0, examples: [] };
		entry.count += 1;
		if (entry.examples.length < 3) entry.examples.push(fixExample(fix));
		grouped.set(fix.kind, entry);
	}

	const items: FixSummaryItem[] = [];
	for (const kind of FIX_KIND_ORDER) {
		const entry = grouped.get(kind);
		if (!entry) continue;
		items.push({
			kind,
			count: entry.count,
			examples: entry.examples,
			label: buildFixItemLabel(kind, entry.count, entry.examples)
		});
	}

	const issueWord = fixes.length === 1 ? 'issue' : 'issues';
	return {
		docCount,
		layoutOnly: false,
		headline: `Fixed ${fixes.length} ${issueWord} in ${docCount} ${docWord}`,
		items
	};
}

function dumpFormattedDocs(docs: Record<string, unknown>[]): string {
	const formattedDocs = docs.map((doc) => {
		const sorted = sortCrdKeys(doc) as Record<string, unknown>;
		return yaml.dump(sorted, {
			indent: 2,
			lineWidth: -1,
			noRefs: true,
			sortKeys: false
		});
	});

	return formattedDocs.length === 1
		? formattedDocs[0].trimEnd() + '\n'
		: formattedDocs.map((doc) => doc.trimEnd()).join('\n---\n') + '\n';
}

/** Parse, optionally auto-fix against CRD schemas, sort keys, and re-dump a YAML bundle. */
export async function formatYamlBundle(
	yamlInput: string,
	options?: FormatYamlOptions
): Promise<FormatYamlResult> {
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

	let fixes: FixReport[] = [];
	const docData = parsed.docs.map((doc) => ({ ...doc }));

	for (const doc of docData) {
		const { data, fixes: k8sFixes } = fixK8sMetadata(doc.data, doc.index + 1);
		doc.data = data;
		fixes.push(...k8sFixes);
	}

	if (options?.manifest?.length) {
		for (const doc of docData) {
			const { data, fixes: identityFixes } = fixManifestIdentity(
				doc.data,
				options.manifest,
				doc.index + 1
			);
			doc.data = data;
			fixes.push(...identityFixes);
		}

		for (const doc of docData) {
			const { data, fixes: upgradeFixes } = fixApiVersionUpgrade(
				doc.data,
				options.manifest,
				doc.index + 1
			);
			doc.data = data;
			fixes.push(...upgradeFixes);
		}
	}

	if (options?.manifest?.length && options.releaseFolder) {
		fixes.push(...(await fixYamlDocuments(docData, options)));
	}

	let formatted = dumpFormattedDocs(docData.map((doc) => doc.data));

	const booleanSourceFix = fixInvalidBooleanLiterals(formatted);
	if (booleanSourceFix.fixes.length > 0) {
		formatted = booleanSourceFix.yaml;
		for (const fix of booleanSourceFix.fixes) {
			fixes.push({
				kind: 'booleanCoercion',
				path: `line:${fix.line}`,
				from: fix.from,
				to: fix.to,
				docIndex: 1
			});
		}
	}

	return { ok: true, formatted, docCount: parsed.docs.length, fixes };
}
