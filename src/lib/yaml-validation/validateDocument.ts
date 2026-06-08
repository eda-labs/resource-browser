import type { ErrorObject, ValidateFunction } from 'ajv';
import {
	findManifestEntry,
	findManifestEntryCaseMismatch,
	findManifestEntryGroupCaseMismatch,
	findManifestEntryKindCaseMismatchInsensitive,
	findManifestEntriesByGroup,
	findManifestEntriesByKind,
	formatCrdNotFoundMessage,
	formatInvalidApiVersionMessage,
	formatKindCaseMismatchMessage
} from '$lib/manifest/lookup';
import { getLatestVersion } from '$lib/versions';
import {
	collectMissingRequiredFields,
	formatRequiredFieldMessage
} from '$lib/schema/requiredFields';
import { formatValueConstraintError } from './formatSchemaError';
import { formatVersionLabel } from './formatErrors';
import { formatLocationInfo, getFieldLocationInfo } from './parseDocuments';
import type { EnrichedError, ManifestEntry, ParsedDocument, SuggestedFix } from './types';
import type { SchemaSections } from './schemaCache';

type ValidateDocContext = {
	doc: ParsedDocument;
	totalDocs: number;
	releaseFolder: string;
	releaseLabel: string;
	manifest: ManifestEntry[];
	schemas: Map<string, SchemaSections>;
	getSpecValidator: (key: string, schema: unknown) => ValidateFunction;
	getStatusValidator: (key: string, schema: unknown) => ValidateFunction;
};

function docPrefix(index: number, total: number) {
	return total > 1 ? `[Doc ${index + 1}] ` : '';
}

function ajvReportsRequired(errors: ErrorObject[] | null | undefined, instancePath: string): boolean {
	return (errors || []).some(
		(err) => err.keyword === 'required' && err.instancePath === instancePath
	);
}

function enrichRequiredFieldErrors(
	missing: ReturnType<typeof collectMissingRequiredFields>,
	ctx: {
		prefix: string;
		section: 'spec' | 'status';
		doc: ParsedDocument;
		docIndex: number;
		resourceLink?: { name: string; version: string };
		ajvErrors?: ErrorObject[] | null;
		keyword?: string;
	}
): EnrichedError[] {
	const enriched: EnrichedError[] = [];
	for (const item of missing) {
		if (ajvReportsRequired(ctx.ajvErrors, item.instancePath)) continue;
		const fieldLocationInfo = getFieldLocationInfo(
			ctx.doc.rawText,
			ctx.doc.startLine,
			`/${ctx.section}${item.instancePath}`
		);
		const lineMatch = fieldLocationInfo.match(/Line\s+(\d+)/i);
		const message = `${ctx.prefix}${ctx.section}.${item.path} is required${fieldLocationInfo}`;
		enriched.push(
			enrichError(
				{
					message,
					instancePath: `/${ctx.section}${item.instancePath}`,
					schemaPath: '#/required',
					keyword: ctx.keyword || 'required',
					params: { missingProperty: item.field }
				} as ErrorObject,
				{
					docIndex: ctx.docIndex,
					docPrefix: ctx.prefix,
					locationInfo: fieldLocationInfo,
					resourceLink: ctx.resourceLink,
					line: lineMatch ? Number(lineMatch[1]) : undefined
				}
			)
		);
	}
	return enriched;
}

function lineFromLocationInfo(locationInfo: string): number | undefined {
	const match = locationInfo.match(/Line\s+(\d+)/i);
	return match ? Number(match[1]) : undefined;
}

function enrichError(
	err: ErrorObject,
	ctx: {
		docIndex: number;
		docPrefix: string;
		locationInfo: string;
		resourceLink?: { name: string; version: string };
		line?: number;
		suggestedFix?: SuggestedFix;
	}
): EnrichedError {
	const line = ctx.line ?? lineFromLocationInfo(ctx.locationInfo);
	return {
		...err,
		docIndex: ctx.docIndex + 1,
		resourceLink: ctx.resourceLink,
		line,
		suggestedFix: ctx.suggestedFix
			? { ...ctx.suggestedFix, line: ctx.suggestedFix.line ?? line }
			: undefined
	};
}

export function validateDocument(ctx: ValidateDocContext): {
	errors: EnrichedError[];
	warnings: EnrichedError[];
	valid: boolean;
	schemaPath?: string;
} {
	const { doc, totalDocs, releaseLabel, manifest, schemas } = ctx;
	const parsedYaml = doc.data;
	const prefix = docPrefix(doc.index, totalDocs);
	const locationInfo = formatLocationInfo(doc.startLine, 0);
	const errors: EnrichedError[] = [];
	const warnings: EnrichedError[] = [];
	let valid = true;

	const getFieldLoc = (fieldPath: string) =>
		getFieldLocationInfo(doc.rawText, doc.startLine, fieldPath);

	let group = '';
	let version = '';

	if (!parsedYaml.apiVersion) {
		errors.push(
			enrichError(
				{
					message: `${prefix}Missing required 'apiVersion' field${locationInfo}`,
					instancePath: '/apiVersion',
					schemaPath: '#/required',
					keyword: 'required',
					params: { missingProperty: 'apiVersion' }
				} as ErrorObject,
				{ docIndex: doc.index, docPrefix: prefix, locationInfo, line: doc.startLine + 1 }
			)
		);
		valid = false;
	} else {
		const apiVersionParts = String(parsedYaml.apiVersion).split('/');
		if (apiVersionParts.length !== 2) {
			errors.push(
				enrichError(
					{
						message: `${prefix}Invalid apiVersion format: '${parsedYaml.apiVersion}' (expected 'group/version')${locationInfo}`,
						instancePath: '/apiVersion',
						schemaPath: '#/properties/apiVersion/pattern',
						keyword: 'pattern',
						params: {}
					} as ErrorObject,
					{ docIndex: doc.index, docPrefix: prefix, locationInfo }
				)
			);
			valid = false;
		} else {
			group = apiVersionParts[0];
			version = apiVersionParts[1];
		}
	}

	if (!parsedYaml.kind) {
		errors.push(
			enrichError(
				{
					message: `${prefix}Missing required 'kind' field${locationInfo}`,
					instancePath: '/kind',
					schemaPath: '#/required',
					keyword: 'required',
					params: { missingProperty: 'kind' }
				} as ErrorObject,
				{ docIndex: doc.index, docPrefix: prefix, locationInfo }
			)
		);
		valid = false;
	}

	if (!parsedYaml.metadata) {
		errors.push(
			enrichError(
				{
					message: `${prefix}Missing required 'metadata' field${locationInfo}`,
					instancePath: '/metadata',
					schemaPath: '#/required',
					keyword: 'required',
					params: { missingProperty: 'metadata' }
				} as ErrorObject,
				{ docIndex: doc.index, docPrefix: prefix, locationInfo }
			)
		);
		valid = false;
	} else {
		const metadata = parsedYaml.metadata as Record<string, unknown>;
		if (!metadata.name) {
			errors.push(
				enrichError(
					{
						message: `${prefix}Missing required 'metadata.name' field${locationInfo}`,
						instancePath: '/metadata/name',
						schemaPath: '#/properties/metadata/required',
						keyword: 'required',
						params: { missingProperty: 'name' }
					} as ErrorObject,
					{ docIndex: doc.index, docPrefix: prefix, locationInfo }
				)
			);
			valid = false;
		}
		if (
			metadata.name &&
			!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(String(metadata.name))
		) {
			errors.push(
				enrichError(
					{
						message: `${prefix}metadata.name must be a valid DNS subdomain (lowercase alphanumeric, hyphens, dots)${locationInfo}`,
						instancePath: '/metadata/name',
						schemaPath: '#/properties/metadata/properties/name/pattern',
						keyword: 'pattern',
						params: { pattern: 'DNS subdomain' }
					} as ErrorObject,
					{ docIndex: doc.index, docPrefix: prefix, locationInfo }
				)
			);
			valid = false;
		}
	}

	let resourceLink: { name: string; version: string } | undefined;
	let schemaKey: string | undefined;
	let schemaSections: SchemaSections | undefined;

	if (parsedYaml.kind && group) {
		const kindStr = String(parsedYaml.kind);
		const apiVersionStr = String(parsedYaml.apiVersion);
		const resourceEntry = findManifestEntry(manifest, kindStr, group);
		if (!resourceEntry) {
			const kindCaseMismatch =
				findManifestEntryCaseMismatch(manifest, kindStr, group) ??
				findManifestEntryKindCaseMismatchInsensitive(manifest, kindStr, group);
			const groupCaseMismatch = findManifestEntryGroupCaseMismatch(manifest, kindStr, group);
			const groupEntries = findManifestEntriesByGroup(manifest, group);
			const kindEntries = findManifestEntriesByKind(manifest, kindStr);
			let crdMessage: string;
			let instancePath = '/kind';
			let suggestedFix: SuggestedFix | undefined;
			let fieldLocationInfo = locationInfo;

			if (kindCaseMismatch?.kind) {
				crdMessage = formatKindCaseMismatchMessage(kindCaseMismatch.kind, kindStr);
				instancePath = '/kind';
				fieldLocationInfo = getFieldLoc('/kind');
				suggestedFix = { field: 'kind', value: kindCaseMismatch.kind };
			} else if (groupCaseMismatch?.group) {
				const suggestedApiVersion = `${groupCaseMismatch.group}/${version}`;
				crdMessage = formatInvalidApiVersionMessage(
					apiVersionStr,
					suggestedApiVersion,
					kindStr
				);
				instancePath = '/apiVersion';
				fieldLocationInfo = getFieldLoc('/apiVersion');
				suggestedFix = { field: 'apiVersion', value: suggestedApiVersion };
			} else if (groupEntries.length === 1) {
				crdMessage = `kind '${kindStr}' is not supported for apiVersion '${apiVersionStr}'. Expected kind '${groupEntries[0].kind}'`;
				instancePath = '/kind';
				fieldLocationInfo = getFieldLoc('/kind');
			} else if (kindEntries.length === 1 && kindEntries[0].group !== group) {
				const entry = kindEntries[0];
				const latest = getLatestVersion(entry);
				const suggestedApiVersion =
					entry.group && latest ? `${entry.group}/${latest}` : undefined;
				if (suggestedApiVersion) {
					crdMessage = formatInvalidApiVersionMessage(
						apiVersionStr,
						suggestedApiVersion,
						kindStr
					);
					suggestedFix = { field: 'apiVersion', value: suggestedApiVersion };
				} else {
					crdMessage = formatCrdNotFoundMessage(apiVersionStr, kindStr);
				}
				instancePath = '/apiVersion';
				fieldLocationInfo = getFieldLoc('/apiVersion');
			} else {
				crdMessage = formatCrdNotFoundMessage(apiVersionStr, kindStr);
				instancePath = groupEntries.length > 0 ? '/kind' : '/apiVersion';
				fieldLocationInfo = getFieldLoc(instancePath);
			}

			errors.push(
				enrichError(
					{
						message: `${prefix}${crdMessage}${fieldLocationInfo}`,
						instancePath,
						schemaPath:
							instancePath === '/kind' ? '#/properties/kind' : '#/properties/apiVersion',
						keyword: 'enum',
						params: {}
					} as ErrorObject,
					{
						docIndex: doc.index,
						docPrefix: prefix,
						locationInfo: fieldLocationInfo,
						suggestedFix
					}
				)
			);
			valid = false;
		} else {
			resourceLink = { name: resourceEntry.name, version };
			const supportedVersions = (resourceEntry.versions || []).map((v) => v?.name).filter(Boolean);
			const supportedVersionsDetailed = (resourceEntry.versions || [])
				.map((v) => formatVersionLabel(v))
				.filter(Boolean);
			const nonDeprecatedVersions = (resourceEntry.versions || [])
				.filter((v) => v?.name && !v?.deprecated)
				.map((v) => v.name);
			const deprecatedVersions = (resourceEntry.versions || [])
				.filter((v) => v?.name && v?.deprecated)
				.map((v) => v.name);
			const matchedVersionEntry = (resourceEntry.versions || []).find((v) => v?.name === version);
			const latestVersion = getLatestVersion(resourceEntry);

			if (!matchedVersionEntry) {
				const supportedText =
					nonDeprecatedVersions.length > 0
						? `Supported versions: ${nonDeprecatedVersions.join(', ')}`
						: `Supported versions: ${supportedVersionsDetailed.join(', ')}`;
				const deprecatedText =
					deprecatedVersions.length > 0
						? `. Deprecated versions: ${deprecatedVersions.join(', ')}`
						: '';
				errors.push(
					enrichError(
						{
							message: `${prefix}apiVersion '${parsedYaml.apiVersion}' is not supported for kind '${parsedYaml.kind}' in release ${releaseLabel}. ${supportedText}${deprecatedText}${locationInfo}`,
							instancePath: '/apiVersion',
							schemaPath: '#/properties/apiVersion/enum',
							keyword: 'enum',
							params: { allowedValues: supportedVersions },
							resourceLink
						} as EnrichedError,
						{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
					)
				);
				valid = false;
			} else {
				if (matchedVersionEntry.deprecated) {
					errors.push(
						enrichError(
							{
								message: `${prefix}apiVersion '${parsedYaml.apiVersion}' is deprecated for kind '${parsedYaml.kind}'. Latest version is '${group}/${latestVersion}'${locationInfo}`,
								instancePath: '/apiVersion',
								schemaPath: '#/properties/apiVersion',
								keyword: 'deprecated',
								params: {}
							} as ErrorObject,
							{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
						)
					);
					valid = false;
				}

				if (latestVersion && version !== latestVersion && !matchedVersionEntry.deprecated) {
					warnings.push(
						enrichError(
							{
								message: `${prefix}apiVersion '${parsedYaml.apiVersion}' is not the latest for kind '${parsedYaml.kind}'. Latest version is '${group}/${latestVersion}'${locationInfo}`,
								instancePath: '/apiVersion',
								schemaPath: '#/properties/apiVersion',
								keyword: 'warning',
								params: {}
							} as ErrorObject,
							{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
						)
					);
				}

				if (!latestVersion) {
					errors.push(
						enrichError(
							{
								message: `${prefix}No API versions found for kind '${parsedYaml.kind}' in release ${releaseLabel}${locationInfo}`,
								instancePath: '/apiVersion',
								schemaPath: '#/properties/apiVersion/enum',
								params: {},
								resourceLink
							} as EnrichedError,
							{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
						)
					);
					valid = false;
				} else {
					const schemaVersion = latestVersion;
					schemaKey = `/${ctx.releaseFolder}/${resourceEntry.name}/${schemaVersion}.yaml`;
					schemaSections = schemas.get(schemaKey);

					if (!schemaSections) {
						errors.push(
							enrichError(
								{
									message: `${prefix}Could not find schema for ${parsedYaml.kind} version ${schemaVersion}${locationInfo}`,
									instancePath: '/apiVersion',
									schemaPath: '#/properties/apiVersion',
									keyword: 'schema',
									params: {},
									resourceLink
								} as EnrichedError,
								{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
							)
						);
						valid = false;
					}
				}
			}
		}
	}

	if (!schemaSections) {
		const allowedTopLevel = ['apiVersion', 'kind', 'metadata', 'spec', 'status'];
		const unexpectedFields = Object.keys(parsedYaml).filter((k) => !allowedTopLevel.includes(k));
		if (unexpectedFields.length > 0) {
			warnings.push(
				enrichError(
					{
						message: `${prefix}Unexpected top-level fields: ${unexpectedFields.join(', ')}${locationInfo}`,
						instancePath: '',
						schemaPath: '',
						keyword: 'warning',
						params: {}
					} as ErrorObject,
					{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
				)
			);
		}

		return { errors, warnings, valid, schemaPath: schemaKey };
	}

	const { spec, status, isSpecRequired } = schemaSections;

	if (parsedYaml.spec && spec) {
		const validatorKey = `${schemaKey}::spec`;
		const specValidator = ctx.getSpecValidator(validatorKey, spec);
		const specValid = specValidator(parsedYaml.spec);
		const ajvSpecErrors = specValidator.errors || [];
		if (!specValid) {
			valid = false;
			const docErrors = ajvSpecErrors.map((err) => {
				let message = err.message || 'validation error';
				if (err.keyword === 'required') {
					const missingProperty = String(err.params?.missingProperty || '');
					const pointerPath = err.instancePath.replace(/^\//, '').replace(/\//g, '.');
					const fieldPath = [pointerPath, missingProperty].filter(Boolean).join('.');
					message = fieldPath
						? formatRequiredFieldMessage(`spec.${fieldPath}`)
						: message;
				} else if (err.keyword === 'enum' || err.keyword === 'const') {
					const pointerPath = err.instancePath.replace(/^\//, '').replace(/\//g, '.');
					const fieldLabel = pointerPath ? `spec.${pointerPath}` : 'spec';
					message = formatValueConstraintError(err, parsedYaml.spec, fieldLabel);
				}
				const fieldLocationInfo = getFieldLoc(`/spec${err.instancePath}`);
				const lineMatch = fieldLocationInfo.match(/Line\s+(\d+)/i);
				return enrichError(
					{
						...err,
						message: `${prefix}${message}${fieldLocationInfo}`,
						instancePath: `/spec${err.instancePath}`,
						resourceLink
					} as ErrorObject,
					{
						docIndex: doc.index,
						docPrefix: prefix,
						locationInfo: fieldLocationInfo,
						resourceLink,
						line: lineMatch ? Number(lineMatch[1]) : undefined
					}
				);
			});
			errors.push(...docErrors);
		}

		const missingRequired = collectMissingRequiredFields(parsedYaml.spec, spec);
		const supplementalRequired = enrichRequiredFieldErrors(missingRequired, {
			prefix,
			section: 'spec',
			doc,
			docIndex: doc.index,
			resourceLink,
			ajvErrors: ajvSpecErrors
		});
		if (supplementalRequired.length > 0) {
			valid = false;
			errors.push(...supplementalRequired);
		}
	} else if (!parsedYaml.spec) {
		if (isSpecRequired || spec) {
			errors.push(
				enrichError(
					{
						message: `${prefix}Missing required 'spec' field${locationInfo}`,
						instancePath: '/spec',
						schemaPath: '#/required',
						keyword: 'required',
						params: { missingProperty: 'spec' },
						resourceLink
					} as EnrichedError,
					{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
				)
			);
			valid = false;
		}
	}

	if (parsedYaml.status && status) {
		const validatorKey = `${schemaKey}::status`;
		const statusValidator = ctx.getStatusValidator(validatorKey, status);
		if (!statusValidator(parsedYaml.status)) {
			const statusErrors = (statusValidator.errors || []).map((err) => {
				const fieldLocationInfo = getFieldLoc(`/status${err.instancePath}`);
				const lineMatch = fieldLocationInfo.match(/Line\s+(\d+)/i);
				return enrichError(
					{
						...err,
						message: `${prefix}status${err.instancePath}: ${err.message}${fieldLocationInfo}`,
						instancePath: `/status${err.instancePath}`,
						keyword: 'warning',
						resourceLink
					} as ErrorObject,
					{
						docIndex: doc.index,
						docPrefix: prefix,
						locationInfo: fieldLocationInfo,
						resourceLink,
						line: lineMatch ? Number(lineMatch[1]) : undefined
					}
				);
			});
			warnings.push(...statusErrors);
		}
	}

	const allowedTopLevel = ['apiVersion', 'kind', 'metadata', 'spec', 'status'];
	const unexpectedFields = Object.keys(parsedYaml).filter((k) => !allowedTopLevel.includes(k));
	if (unexpectedFields.length > 0) {
		warnings.push(
			enrichError(
				{
					message: `${prefix}Unexpected top-level fields: ${unexpectedFields.join(', ')}${locationInfo}`,
					instancePath: '',
					schemaPath: '',
					keyword: 'warning',
					params: {}
				} as ErrorObject,
				{ docIndex: doc.index, docPrefix: prefix, locationInfo, resourceLink }
			)
		);
	}

	return { errors, warnings, valid, schemaPath: schemaKey };
}

function getValueByPointer(data: unknown, pointer: string) {
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

export type { ValidateDocContext };
