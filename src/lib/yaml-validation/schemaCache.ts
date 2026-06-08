import type { ValidateFunction } from 'ajv';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { normalizeSchemaForAjv } from '$lib/schema/requiredFields';

export type SchemaSections = {
	spec?: unknown;
	status?: unknown;
	topLevel?: unknown;
	isSpecRequired: boolean;
};

const SAFE_PATH_SEGMENT = /^[a-z0-9._-]+$/i;

const schemaTextCache = new Map<string, string>();
const schemaDataCache = new Map<string, SchemaSections>();
const validatorCache = new Map<string, ValidateFunction>();

/** Reject a single path segment that could enable traversal or injection. */
export function assertSafePathSegment(segment: string, label: string): string {
	if (!segment || segment === '.' || segment === '..') {
		throw new Error(`Invalid ${label}`);
	}
	if (segment.includes('/') || segment.includes('\\')) {
		throw new Error(`Unsafe ${label}`);
	}
	if (!SAFE_PATH_SEGMENT.test(segment)) {
		throw new Error(`Invalid ${label}`);
	}
	return segment;
}

/** Validate multi-segment release folders such as `resources/26.4.2`. */
export function assertSafeFolderPath(folder: string): string {
	if (!folder || folder.startsWith('/') || folder.includes('..')) {
		throw new Error('Invalid releaseFolder');
	}
	const parts = folder.split('/').filter(Boolean);
	if (parts.length === 0) throw new Error('Invalid releaseFolder');
	return parts.map((part) => assertSafePathSegment(part, 'releaseFolder')).join('/');
}

export function schemaPath(releaseFolder: string, resourceName: string, version: string): string {
	const folder = assertSafeFolderPath(releaseFolder);
	const name = assertSafePathSegment(resourceName, 'resourceName');
	const ver = assertSafePathSegment(version, 'version');
	return `/${folder}/${name}/${ver}.yaml`;
}

function parseSchemaText(text: string): SchemaSections {
	const schemaParsed = loadStaticYaml(text) as {
		schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown }; required?: string[] } };
	};
	const topLevel = schemaParsed?.schema?.openAPIV3Schema;
	const spec = topLevel?.properties?.spec;
	const status = topLevel?.properties?.status;
	const isSpecRequired = topLevel?.required?.includes('spec') ?? Boolean(spec);
	return { spec, status, topLevel, isSpecRequired };
}

export async function fetchSchema(path: string): Promise<SchemaSections | null> {
	if (schemaDataCache.has(path)) {
		return schemaDataCache.get(path)!;
	}

	let text = schemaTextCache.get(path);
	if (!text) {
		const resp = await fetch(path);
		if (!resp.ok) return null;
		text = await resp.text();
		schemaTextCache.set(path, text);
	}

	const sections = parseSchemaText(text);
	schemaDataCache.set(path, sections);
	return sections;
}

/** Fetch multiple schemas in parallel with deduplication. */
export async function fetchSchemas(paths: string[]): Promise<Map<string, SchemaSections>> {
	const unique = [...new Set(paths)];
	const results = await Promise.all(
		unique.map(async (path) => {
			const data = await fetchSchema(path);
			return [path, data] as const;
		})
	);
	const map = new Map<string, SchemaSections>();
	for (const [path, data] of results) {
		if (data) map.set(path, data);
	}
	return map;
}

export function getOrCompileValidator(
	ajv: { compile: (schema: unknown) => ValidateFunction },
	cacheKey: string,
	schema: unknown
): ValidateFunction {
	const existing = validatorCache.get(cacheKey);
	if (existing) return existing;
	const validator = ajv.compile(normalizeSchemaForAjv(schema));
	validatorCache.set(cacheKey, validator);
	return validator;
}

export { prefetchManifest } from '$lib/manifest';
