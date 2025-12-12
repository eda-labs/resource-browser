import type { Schema } from '$lib/structure';

export function getScope(resource: Schema) {
	return resource.type === 'array' ? resource.items : resource;
}

export function getDescription(resource: Schema) {
	return resource?.description || (resource.type === 'array' ? resource.items.type : '');
}

// Get the default value of a resource field.
export function getDefault(resource: Schema) {
	// prefer explicit default on the resource, otherwise for arrays check items
	const d =
		resource && 'default' in resource && resource.default !== undefined
			? resource.default
			: resource.type === 'array' && resource.items && 'default' in resource.items
				? resource.items.default
				: undefined;

	if (d === undefined) return '';
	try {
		return typeof d === 'object' ? JSON.stringify(d) : String(d);
	} catch (e) {
		return String(d);
	}
}

// Helper to safely get enum array from resource or its items
function getEnumArray(resource: Schema): string[] | undefined {
	if ('enum' in resource && Array.isArray(resource.enum)) {
		return resource.enum;
	}
	if (
		resource.type === 'array' &&
		resource.items &&
		'enum' in resource.items &&
		Array.isArray(resource.items.enum)
	) {
		return resource.items.enum;
	}
	return undefined;
}

// Get the enum values for a resource field as a string like "[a, b, c]"
export function getEnum(resource: Schema) {
	const e = getEnumArray(resource);
	if (!e || e.length === 0) return '';
	try {
		return `[${e.join(', ')}]`;
	} catch (err) {
		return String(e);
	}
}

// Get the format of a resource field (e.g., "int32", "date-time")
export function getFormat(resource: Schema): string {
	if ('format' in resource && resource.format) {
		return resource.format;
	}
	if (
		resource.type === 'array' &&
		resource.items &&
		'format' in resource.items &&
		resource.items.format
	) {
		return resource.items.format;
	}
	return '';
}

// Get minimum constraint value
export function getMinimum(resource: Schema): number | undefined {
	if ('minimum' in resource && resource.minimum !== undefined) {
		return resource.minimum;
	}
	if (
		resource.type === 'array' &&
		resource.items &&
		'minimum' in resource.items &&
		resource.items.minimum !== undefined
	) {
		return resource.items.minimum;
	}
	return undefined;
}

// Get maximum constraint value
export function getMaximum(resource: Schema): number | undefined {
	if ('maximum' in resource && resource.maximum !== undefined) {
		return resource.maximum;
	}
	if (
		resource.type === 'array' &&
		resource.items &&
		'maximum' in resource.items &&
		resource.items.maximum !== undefined
	) {
		return resource.items.maximum;
	}
	return undefined;
}

// Get minItems constraint value for arrays
export function getMinItems(resource: Schema): number | undefined {
	if (resource.type === 'array' && 'minItems' in resource && resource.minItems !== undefined) {
		return resource.minItems;
	}
	return undefined;
}

// Get maxItems constraint value for arrays
export function getMaxItems(resource: Schema): number | undefined {
	if (resource.type === 'array' && 'maxItems' in resource && resource.maxItems !== undefined) {
		return resource.maxItems;
	}
	return undefined;
}

export function hashExistDeep(hash: string, currentId: string) {
	if (hash.indexOf(currentId) !== -1) {
		return true;
	}
	return false;
}

// Remove the first label of an eda.nokia.com FQDN: 'ntpclients.timing.eda.nokia.com' -> 'timing.eda.nokia.com'
export function stripResourcePrefixFQDN(fqdn: string) {
	if (!fqdn || typeof fqdn !== 'string') return fqdn;
	const suffix = '.eda.nokia.com';
	const trimmed = fqdn.trim();
	if (!trimmed.endsWith(suffix)) return trimmed;
	const parts = trimmed.split('.');
	if (parts.length < 3) return trimmed; // not enough parts to strip
	return parts.slice(1).join('.');
}
