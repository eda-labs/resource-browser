import type { ErrorObject } from 'ajv';
import { buildSummary } from './formatErrors';
import { parseDocuments } from './parseDocuments';
import { fetchSchemas, getOrCompileValidator, schemaPath } from './schemaCache';
import { validateDocument } from './validateDocument';
import type { EnrichedError, ValidateYamlOptions, ValidateYamlResult } from './types';
import { getLatestVersion } from '$lib/versions';

export * from './types';
export * from './formatErrors';
export * from './parseDocuments';
export * from './schemaCache';
export {
	collectMissingRequiredFields,
	formatRequiredFieldMessage,
	getRequiredFields,
	hasObjectProperties,
	normalizeSchemaForAjv,
	resolveObjectSchema
} from '$lib/schema/requiredFields';

function findResourceEntry(
	manifest: ValidateYamlOptions['manifest'],
	kind: string,
	group: string
) {
	let entry = manifest.find((r) => r.kind === kind && (!r.group || r.group === group));
	if (!entry) entry = manifest.find((r) => r.kind === kind);
	if (!entry) {
		entry = manifest.find((r) => {
			const kindLower = kind?.toLowerCase();
			const nameLower = r.name?.toLowerCase();
			const resourceType = nameLower?.split('.')[0];
			return resourceType === kindLower;
		});
	}
	return entry;
}

export async function validateYamlInput(options: ValidateYamlOptions): Promise<ValidateYamlResult> {
	const { yamlInput, releaseFolder, releaseLabel, manifest } = options;

	if (!yamlInput.trim()) {
		return { valid: false, errors: [], warnings: [], summary: null, parsedDocs: [] };
	}

	const parsed = parseDocuments(yamlInput);
	if (!parsed.ok) {
		const err: EnrichedError = {
			message: parsed.message,
			instancePath: '',
			schemaPath: '',
			keyword: 'format',
			params: {},
			line: parsed.line,
			column: parsed.column
		};
		return {
			valid: false,
			errors: [err],
			warnings: [],
			summary: null,
			parsedDocs: []
		};
	}

	if (parsed.docs.length === 0) {
		const err: EnrichedError = {
			message: 'No valid YAML documents found',
			instancePath: '',
			schemaPath: '',
			keyword: 'format',
			params: {}
		};
		return {
			valid: false,
			errors: [err],
			warnings: [],
			summary: null,
			parsedDocs: []
		};
	}

	const schemaPaths: string[] = [];
	for (const doc of parsed.docs) {
		const apiVersion = String(doc.data.apiVersion || '');
		const kind = String(doc.data.kind || '');
		if (!apiVersion || !kind) continue;
		const parts = apiVersion.split('/');
		if (parts.length !== 2) continue;
		const [group, version] = parts;
		const resourceEntry = findResourceEntry(manifest, kind, group);
		if (!resourceEntry) continue;
		const latestVersion = getLatestVersion(resourceEntry);
		const schemaVersion = latestVersion;
		if (schemaVersion) {
			schemaPaths.push(schemaPath(releaseFolder, resourceEntry.name, schemaVersion));
		}
	}

	const schemas = await fetchSchemas(schemaPaths);
	const [{ default: Ajv }] = await Promise.all([import('ajv')]);
	const ajv = new Ajv({
		allErrors: true,
		verbose: true,
		strict: false,
		validateFormats: false,
		coerceTypes: false
	});

	const getSpecValidator = (key: string, schema: unknown) => getOrCompileValidator(ajv, key, schema);
	const getStatusValidator = (key: string, schema: unknown) => getOrCompileValidator(ajv, key, schema);

	let valid = true;
	const errors: EnrichedError[] = [];
	const warnings: EnrichedError[] = [];

	for (const doc of parsed.docs) {
		const result = validateDocument({
			doc,
			totalDocs: parsed.docs.length,
			releaseFolder,
			releaseLabel,
			manifest,
			schemas,
			getSpecValidator,
			getStatusValidator
		});
		errors.push(...result.errors);
		warnings.push(...result.warnings);
		if (!result.valid) valid = false;
	}

	const summary = buildSummary(parsed.docs.length, errors, warnings);

	if (valid) {
		const successMsg =
			parsed.docs.length > 1
				? `✓ Successfully validated ${parsed.docs.length} Nokia EDA CRD documents`
				: '✓ Valid Nokia EDA CRD configuration';
		const successEntry: EnrichedError = {
			message: `${successMsg} (release: ${releaseLabel}, latest schema per CRD)`,
			instancePath: '',
			schemaPath: '',
			keyword: 'success',
			params: { warnings: warnings.length }
		};
		return {
			valid: true,
			errors: [successEntry, ...warnings],
			warnings,
			summary,
			parsedDocs: parsed.docs
		};
	}

	return {
		valid: false,
		errors: [...errors, ...warnings],
		warnings,
		summary,
		parsedDocs: parsed.docs
	};
}

export function toErrorObjects(items: EnrichedError[]): ErrorObject[] {
	return items as ErrorObject[];
}
