type JsonSchema = Record<string, unknown>;

export type ResolvedObjectSchema = {
	properties: Record<string, unknown>;
	required: string[];
};

export type RequiredFieldError = {
	/** Dot-separated path, e.g. `dhcp4.options[0].option` */
	path: string;
	/** JSON pointer relative to the validated root, e.g. `/dhcp4/options/0/option` */
	instancePath: string;
	field: string;
	keyword: 'required';
};

function isObjectSchema(node: unknown): node is JsonSchema {
	return !!node && typeof node === 'object' && !Array.isArray(node);
}

function mergeResolved(
	target: ResolvedObjectSchema,
	source: ResolvedObjectSchema | null
): ResolvedObjectSchema {
	if (!source) return target;
	return {
		properties: { ...target.properties, ...source.properties },
		required: [...new Set([...target.required, ...source.required])]
	};
}

function collectFromNode(node: JsonSchema): ResolvedObjectSchema {
	let result: ResolvedObjectSchema = { properties: {}, required: [] };

	if (node.properties && typeof node.properties === 'object') {
		result.properties = { ...(node.properties as Record<string, unknown>) };
	}
	if (Array.isArray(node.required)) {
		result.required = node.required.filter((field): field is string => typeof field === 'string');
	}

	for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
		const branches = node[comb];
		if (!Array.isArray(branches)) continue;
		for (const branch of branches) {
			result = mergeResolved(result, resolveObjectSchema(branch));
		}
	}

	return result;
}

/** Resolve combinators and return effective object properties + required names. */
export function resolveObjectSchema(schema: unknown): ResolvedObjectSchema | null {
	if (!isObjectSchema(schema)) return null;

	const direct = collectFromNode(schema);
	if (Object.keys(direct.properties).length > 0 || direct.required.length > 0) {
		return direct;
	}

	if (schema.items) {
		return resolveObjectSchema(schema.items);
	}

	return null;
}

/** Required property names at the current schema object level. */
export function getRequiredFields(schema: unknown): string[] {
	return resolveObjectSchema(schema)?.required ?? [];
}

/** Whether the schema node has nested object properties to display. */
export function hasObjectProperties(schema: unknown): boolean {
	const resolved = resolveObjectSchema(schema);
	return !!resolved && Object.keys(resolved.properties).length > 0;
}

export function getPropertySchema(schema: unknown, key: string): unknown {
	return resolveObjectSchema(schema)?.properties[key] ?? null;
}

function toInstancePath(dotPath: string): string {
	const parts: string[] = [];
	for (const segment of dotPath.split('.')) {
		if (!segment) continue;
		const match = segment.match(/^(.+)\[(\d+)\]$/);
		if (match) {
			parts.push(match[1], match[2]);
		} else {
			parts.push(segment);
		}
	}
	return parts.length > 0 ? `/${parts.join('/')}` : '';
}

function joinPath(prefix: string, segment: string): string {
	return prefix ? `${prefix}.${segment}` : segment;
}

function getItemsSchema(schema: unknown): unknown {
	if (!isObjectSchema(schema)) return null;
	if (schema.items) return schema.items;
	return resolveObjectSchema(schema);
}

/** Walk schema + data and collect missing required fields not already reported. */
export function collectMissingRequiredFields(
	data: unknown,
	schema: unknown,
	pathPrefix = ''
): RequiredFieldError[] {
	const errors: RequiredFieldError[] = [];
	const resolved = resolveObjectSchema(schema);
	if (!resolved) return errors;

	const record =
		data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: null;

	for (const field of resolved.required) {
		const value = record?.[field];
		if (value === undefined || value === null) {
			const path = joinPath(pathPrefix, field);
			errors.push({
				path,
				instancePath: toInstancePath(path),
				field,
				keyword: 'required'
			});
		}
	}

	if (!record) return errors;

	for (const [key, propSchema] of Object.entries(resolved.properties)) {
		const value = record[key];
		if (value === undefined || value === null) continue;

		const childPrefix = joinPath(pathPrefix, key);

		if (Array.isArray(value)) {
			const itemsSchema = getItemsSchema(propSchema);
			if (!itemsSchema) continue;
			for (let i = 0; i < value.length; i++) {
				errors.push(
					...collectMissingRequiredFields(value[i], itemsSchema, `${childPrefix}[${i}]`)
				);
			}
			continue;
		}

		if (typeof value === 'object') {
			errors.push(...collectMissingRequiredFields(value, propSchema, childPrefix));
		}
	}

	return errors;
}

/** Add `type: object` where properties exist so AJV enforces `required`. */
export function normalizeSchemaForAjv(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object') return schema;
	if (Array.isArray(schema)) return schema.map(normalizeSchemaForAjv);

	const s = { ...(schema as JsonSchema) };

	if (s.properties && typeof s.properties === 'object' && !s.type) {
		s.type = 'object';
	}

	if (s.properties && typeof s.properties === 'object') {
		const props: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(s.properties)) {
			props[key] = normalizeSchemaForAjv(value);
		}
		s.properties = props;
	}

	if (s.items) {
		s.items = normalizeSchemaForAjv(s.items);
	}

	for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
		if (Array.isArray(s[comb])) {
			s[comb] = s[comb].map(normalizeSchemaForAjv);
		}
	}

	if (s.additionalProperties && typeof s.additionalProperties === 'object') {
		s.additionalProperties = normalizeSchemaForAjv(s.additionalProperties);
	}

	return s;
}

export function formatRequiredFieldMessage(path: string): string {
	return `${path} is required`;
}
