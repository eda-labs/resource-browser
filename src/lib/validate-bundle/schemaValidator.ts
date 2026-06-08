import { findManifestEntry } from '$lib/manifest/lookup';
import { resolveObjectSchema } from '$lib/schema/requiredFields';
import { getLatestVersion } from '$lib/versions';
import { schemaPath, fetchSchemas } from '$lib/yaml-validation/schemaCache';
import { validateYamlInput } from '$lib/yaml-validation';
import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import type { EnrichedError, ManifestEntry } from '$lib/yaml-validation/types';
import type { BundleIssue, BundleResource } from './types';

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `schema-${issueCounter}`;
}

function isWarningError(err: EnrichedError): boolean {
	return err.keyword === 'warning';
}

function toBundleIssue(err: EnrichedError, resource?: BundleResource): BundleIssue {
	const severity = err.keyword === 'success' ? 'info' : isWarningError(err) ? 'warning' : 'error';
	return {
		id: nextIssueId(),
		severity,
		category: 'schema',
		message: (err.message || 'Validation error').replace(/^\[Doc \d+\]\s*/, ''),
		resourceName: resource?.name,
		resourceKind: resource?.kind,
		docIndex: err.docIndex ?? (resource ? resource.docIndex + 1 : undefined),
		line: err.line,
		fieldPath: err.instancePath || undefined,
		suggestedFix: err.suggestedFix
	};
}

function collectSchemaProperties(schema: unknown): Set<string> | null {
	if (!schema || typeof schema !== 'object') return null;
	const s = schema as Record<string, unknown>;
	if (s.properties && typeof s.properties === 'object') {
		return new Set(Object.keys(s.properties as Record<string, unknown>));
	}
	return null;
}

function joinFieldPath(key: string, parent: string): string {
	return parent ? `${parent}.${key}` : key;
}

function getItemsSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
	const node = schema as Record<string, unknown>;
	if (node.items) return node.items;
	return resolveObjectSchema(schema);
}

function getChildPropertySchema(schema: unknown, key: string): unknown {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
	const node = schema as Record<string, unknown>;
	if (node.properties && typeof node.properties === 'object') {
		return (node.properties as Record<string, unknown>)[key] ?? null;
	}
	return resolveObjectSchema(schema)?.properties[key] ?? null;
}

/** Walk data against schema properties; flags keys not defined in the CRD schema. */
export function walkUnknownFields(
	data: unknown,
	schema: unknown,
	path: string,
	doc: BundleResource['doc'],
	prefix: string,
	issues: BundleIssue[],
	resource: BundleResource
): void {
	if (data === null || data === undefined) return;

	if (Array.isArray(data)) {
		const itemsSchema = getItemsSchema(schema);
		if (!itemsSchema) return;
		const itemObjectSchema = resolveObjectSchema(itemsSchema) ?? itemsSchema;
		data.forEach((item, index) => {
			if (item !== null && item !== undefined && typeof item === 'object') {
				walkUnknownFields(
					item,
					itemObjectSchema,
					`${path}[${index}]`,
					doc,
					prefix,
					issues,
					resource
				);
			}
		});
		return;
	}

	if (typeof data !== 'object') return;

	const props = collectSchemaProperties(schema);
	if (!props) return;

	const record = data as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!props.has(key)) {
			const fieldPath = joinFieldPath(key, path);
			const pointer = `${prefix}${fieldPath.replace(/^spec\./, '').replace(/\./g, '/')}`;
			const rel = findLineForPointerInDoc(doc.rawText, `/spec/${pointer}`);
			const line = rel !== undefined ? doc.startLine + rel + 1 : undefined;
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'schema',
				message: `Unknown field "${fieldPath}" — not defined in the CRD schema for ${resource.kind}`,
				resourceName: resource.name,
				resourceKind: resource.kind,
				docIndex: resource.docIndex + 1,
				line,
				fieldPath
			});
		} else if (record[key] && typeof record[key] === 'object') {
			const childSchema = getChildPropertySchema(schema, key);
			walkUnknownFields(
				record[key],
				childSchema,
				joinFieldPath(key, path),
				doc,
				prefix,
				issues,
				resource
			);
		}
	}
}

export async function validateBundleSchema(
	yamlInput: string,
	resources: BundleResource[],
	releaseFolder: string,
	releaseLabel: string,
	manifest: ManifestEntry[]
): Promise<BundleIssue[]> {
	issueCounter = 0;
	const issues: BundleIssue[] = [];

	const result = await validateYamlInput({
		yamlInput,
		releaseFolder,
		releaseLabel,
		manifest
	});

	for (const err of result.errors) {
		if (err.keyword === 'success') continue;
		const resource =
			err.docIndex !== undefined
				? resources.find((r) => r.docIndex + 1 === err.docIndex)
				: undefined;
		issues.push(toBundleIssue(err, resource));
	}

	const schemaPaths: string[] = [];
	for (const res of resources) {
		if (!res.kind || !res.group) continue;
		const entry = findManifestEntry(manifest, res.kind, res.group);
		if (!entry) continue;
		const latest = getLatestVersion(entry);
		if (latest) schemaPaths.push(schemaPath(releaseFolder, entry.name, latest));
	}

	const schemas = await fetchSchemas(schemaPaths);

	for (const res of resources) {
		if (!res.kind || !res.group) continue;
		const entry = findManifestEntry(manifest, res.kind, res.group);
		if (!entry) continue;
		const latest = getLatestVersion(entry);
		if (!latest) continue;
		const key = schemaPath(releaseFolder, entry.name, latest);
		const sections = schemas.get(key);
		if (!sections?.spec || !res.data.spec) continue;
		walkUnknownFields(
			res.data.spec,
			sections.spec,
			'spec',
			res.doc,
			'/spec/',
			issues,
			res
		);
	}

	return issues;
}
