export type PathInfo = {
	path: string;
	type?: string;
	enum?: unknown[];
	default?: unknown;
	constraints?: string[];
};

export function ensureRenderable(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object') return schema;
	const s = schema as Record<string, unknown>;
	if ('type' in s || 'properties' in s || 'items' in s) {
		try {
			const props = s.properties as Record<string, unknown> | undefined;
			if (
				props?.spec &&
				typeof props.spec === 'object' &&
				props.spec !== null &&
				(('properties' in (props.spec as object)) || ('items' in (props.spec as object)))
			) {
				return ensureRenderable(props.spec);
			}
		} catch {
			/* fall through */
		}
		return schema;
	}
	try {
		return { type: 'object', properties: schema };
	} catch {
		return schema;
	}
}

export function stripDescriptions(obj: unknown): unknown {
	if (obj == null) return obj;
	if (Array.isArray(obj)) return obj.map(stripDescriptions);
	if (typeof obj === 'object') {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(obj as object)) {
			if (k === 'description') continue;
			out[k] = stripDescriptions((obj as Record<string, unknown>)[k]);
		}
		return out;
	}
	return obj;
}

export function restoreDescriptions(node: unknown, original: unknown, isRoot = false): unknown {
	if (!node || typeof node !== 'object') return node;
	if (!original || typeof original !== 'object') return node;
	const n = node as Record<string, unknown>;
	const o = original as Record<string, unknown>;
	try {
		if (!isRoot && 'description' in o && o.description && !('description' in n)) {
			n.description = o.description;
		}
	} catch {
		/* ignore */
	}
	if (n.properties && o.properties) {
		const props = n.properties as Record<string, unknown>;
		const origProps = o.properties as Record<string, unknown>;
		for (const k of Object.keys(props)) {
			props[k] = restoreDescriptions(props[k], origProps[k], false);
		}
	}
	if (n.items && o.items) {
		n.items = restoreDescriptions(n.items, o.items, false);
	}
	return node;
}

function normalizeToken(s: string): { spaced: string; compact: string } {
	const spaced = String(s)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[_.\-]/g, ' ')
		.toLowerCase();
	return { spaced, compact: spaced.replace(/\s+/g, '') };
}

function nameMatchesQuery(name: string, q: string): boolean {
	if (!q) return false;
	const { spaced, compact } = normalizeToken(name);
	const qNorm = normalizeToken(q);
	return spaced.includes(qNorm.spaced) || compact.includes(qNorm.compact);
}

export function pruneSchema(
	node: unknown,
	q: string,
	includeDesc = false
): unknown | null {
	if (node == null) return null;
	if (typeof node !== 'object' || (Array.isArray(node) && node.length === 0)) {
		return null;
	}
	const src = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	let matched = false;

	function copyMeta(from: Record<string, unknown>, to: Record<string, unknown>) {
		for (const k of [
			'type',
			'format',
			'enum',
			'default',
			'minimum',
			'maximum',
			'minLength',
			'maxLength',
			'pattern',
			'title'
		]) {
			if (k in from && from[k] !== undefined) to[k] = from[k];
		}
	}

	if (includeDesc && typeof src.description === 'string' && q) {
		const qLower = q.toLowerCase();
		if (src.description.toLowerCase().includes(qLower)) {
			matched = true;
			copyMeta(src, out);
			out.description = src.description;
		}
	}

	if (src.properties && typeof src.properties === 'object') {
		const props: Record<string, unknown> = {};
		for (const [pname, pval] of Object.entries(src.properties as Record<string, unknown>)) {
			if (nameMatchesQuery(pname, q)) {
				props[pname] = stripDescriptions(pval);
				matched = true;
				continue;
			}
			const pr = pruneSchema(pval, q, includeDesc);
			if (pr != null) {
				props[pname] = pr;
				matched = true;
			}
		}
		if (Object.keys(props).length > 0) {
			out.properties = props;
			if (src.type) out.type = src.type;
		}
	}

	if (src.items) {
		const pr = pruneSchema(src.items, q, includeDesc);
		if (pr != null) {
			out.items = pr;
			if (src.type) out.type = src.type;
			matched = true;
		}
	}

	for (const comb of ['allOf', 'anyOf', 'oneOf'] as const) {
		if (Array.isArray(src[comb])) {
			const arr: unknown[] = [];
			for (const el of src[comb]) {
				const pr = pruneSchema(el, q, includeDesc);
				if (pr != null) {
					arr.push(pr);
					matched = true;
				}
			}
			if (arr.length > 0) out[comb] = arr;
		}
	}

	if (src.additionalProperties && typeof src.additionalProperties === 'object') {
		const pr = pruneSchema(src.additionalProperties, q, includeDesc);
		if (pr != null) {
			out.additionalProperties = pr;
			matched = true;
		}
	}

	if ('title' in src && src.title !== undefined && q) {
		if (nameMatchesQuery(String(src.title), q)) {
			out.title = src.title;
			matched = true;
		}
	}

	if (!matched) return null;
	copyMeta(src, out);
	return out;
}

export function extractPaths(obj: unknown, prefix = '', paths: PathInfo[] = []): PathInfo[] {
	if (!obj || typeof obj !== 'object') return paths;
	const node = obj as Record<string, unknown>;

	if (node.properties && typeof node.properties === 'object') {
		for (const key of Object.keys(node.properties as object)) {
			const path = prefix ? `${prefix}.${key}` : key;
			const prop = (node.properties as Record<string, unknown>)[key] as Record<string, unknown>;
			const hasNestedProperties =
				prop.properties && Object.keys(prop.properties as object).length > 0;
			const items = prop.items as Record<string, unknown> | undefined;
			const hasArrayItems = items && (items.properties || items.items);
			const isLeaf = !hasNestedProperties && !hasArrayItems;

			if (isLeaf) {
				const pathInfo: PathInfo = { path };
				if (prop.type) pathInfo.type = String(prop.type);
				if (Array.isArray(prop.enum)) pathInfo.enum = prop.enum;
				if (prop.default !== undefined) pathInfo.default = prop.default;
				const constraints: string[] = [];
				if (prop.minimum !== undefined) constraints.push(`min: ${prop.minimum}`);
				if (prop.maximum !== undefined) constraints.push(`max: ${prop.maximum}`);
				if (prop.minLength !== undefined) constraints.push(`minLen: ${prop.minLength}`);
				if (prop.maxLength !== undefined) constraints.push(`maxLen: ${prop.maxLength}`);
				if (prop.pattern) constraints.push(`pattern: ${prop.pattern}`);
				if (constraints.length > 0) pathInfo.constraints = constraints;
				paths.push(pathInfo);
			}
			extractPaths(prop, path, paths);
		}
	}

	if (node.items) {
		extractPaths(node.items, prefix, paths);
	}

	return paths;
}

export function markMatchingNodes(
	fullSchema: unknown,
	matchedPaths: Set<string>,
	currentPath = ''
): unknown {
	if (!fullSchema || typeof fullSchema !== 'object') return fullSchema;
	const src = fullSchema as Record<string, unknown>;
	const result = { ...src };

	if (result.properties && typeof result.properties === 'object') {
		const newProps: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
			const path = currentPath ? `${currentPath}.${key}` : key;
			const markedValue = markMatchingNodes(value, matchedPaths, path);
			newProps[key] = matchedPaths.has(path)
				? { ...(markedValue as object), __diffStatus: 'modified' }
				: markedValue;
		}
		result.properties = newProps;
	}

	if (result.items) {
		result.items = markMatchingNodes(result.items, matchedPaths, currentPath);
	}

	return result;
}

export function prepareMatchSchema(
	pruned: Record<string, unknown>,
	original: Record<string, unknown>
): unknown {
	let readySchema: unknown = pruned;
	try {
		if (
			(!pruned.properties || Object.keys(pruned.properties as object).length === 0) &&
			Array.isArray(pruned.required) &&
			original.properties
		) {
			const focusedProps: Record<string, unknown> = {};
			for (const rk of pruned.required as string[]) {
				if (rk in (original.properties as object)) {
					focusedProps[rk] = (original.properties as Record<string, unknown>)[rk];
				}
			}
			if (Object.keys(focusedProps).length > 0) {
				readySchema = {
					type: 'object',
					properties: focusedProps,
					required: pruned.required
				};
			}
		}
	} catch {
		readySchema = pruned;
	}
	try {
		readySchema = restoreDescriptions(readySchema, original, true);
	} catch {
		/* ignore */
	}
	return ensureRenderable(readySchema);
}
