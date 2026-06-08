import type { ErrorObject } from 'ajv';
import { findManifestEntry } from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import { buildSummary } from './formatErrors';
import { parseDocuments } from './parseDocuments';
import { scanInvalidBooleanLiterals } from './scanSource';
import { fetchSchemas, getOrCompileValidator, schemaPath } from './schemaCache';
import { validateDocument } from './validateDocument';
import type { EnrichedError, ValidateYamlOptions, ValidateYamlResult } from './types';

export * from './types';
export * from './formatErrors';
export * from './parseDocuments';
export * from './scanSource';
export * from './formatSchemaError';
export * from './schemaCache';
export {
	collectMissingRequiredFields,
	formatRequiredFieldMessage,
	getRequiredFields,
	hasObjectProperties,
	normalizeSchemaForAjv,
	resolveObjectSchema
} from '$lib/schema/requiredFields';

export async function validateYamlInput(options: ValidateYamlOptions): Promise<ValidateYamlResult> {
	const { yamlInput, releaseFolder, releaseLabel, manifest } = options;

	if (!yamlInput.trim()) {
		return { valid: false, errors: [], warnings: [], summary: null, parsedDocs: [] };
	}

	const parsed = parseDocuments(yamlInput);
	const docs = parsed.ok ? parsed.docs : (parsed.docs ?? []);
	const parseErrors = parsed.ok ? [] : (parsed.parseErrors ?? []);

	const parseErrorItems: EnrichedError[] = parseErrors.map((err) => ({
		message: err.message,
		instancePath: '',
		schemaPath: '',
		keyword: 'format',
		params: {},
		line: err.line,
		column: err.column,
		docIndex: err.docIndex
	}));

	if (!parsed.ok && docs.length === 0) {
		const errors =
			parseErrorItems.length > 0
				? parseErrorItems
				: [
						{
							message: parsed.message,
							instancePath: '',
							schemaPath: '',
							keyword: 'format',
							params: {},
							line: parsed.line,
							column: parsed.column
						} as EnrichedError
					];
		return {
			valid: false,
			errors,
			warnings: [],
			summary: null,
			parsedDocs: []
		};
	}

	const sourceIssues = scanInvalidBooleanLiterals(yamlInput);
	const sourceErrors: EnrichedError[] = sourceIssues.map((issue) => ({
		message: issue.message,
		instancePath: '',
		schemaPath: '',
		keyword: issue.keyword,
		params: {},
		line: issue.line,
		column: issue.column
	}));

	if (docs.length === 0) {
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
	for (const doc of docs) {
		const apiVersion = String(doc.data.apiVersion || '');
		const kind = String(doc.data.kind || '');
		if (!apiVersion || !kind) continue;
		const parts = apiVersion.split('/');
		if (parts.length !== 2) continue;
		const [group, version] = parts;
		const resourceEntry = findManifestEntry(manifest, kind, group);
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

	for (const doc of docs) {
		const result = validateDocument({
			doc,
			totalDocs: docs.length,
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

	const summary = buildSummary(docs.length, errors, warnings);
	const allErrors = [...parseErrorItems, ...sourceErrors, ...errors];
	const hasBlockingIssues = parseErrorItems.length > 0 || sourceErrors.length > 0 || !valid;

	if (!hasBlockingIssues) {
		const successMsg =
			docs.length > 1
				? `✓ Successfully validated ${docs.length} Nokia EDA CRD documents`
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
			parsedDocs: docs
		};
	}

	return {
		valid: false,
		errors: [...allErrors, ...warnings],
		warnings,
		summary,
		parsedDocs: docs
	};
}

export function toErrorObjects(items: EnrichedError[]): ErrorObject[] {
	return items as ErrorObject[];
}
