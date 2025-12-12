export interface CrdVersions {
	name: string;
	deprecated: boolean;
	appVersion: string;
	edaRelease?: string; // EDA release version (e.g., "24.10", "24.11")
}

export interface CrdResource {
	name: string;
	group: string;
	kind: string;
	versions: CrdVersions[];
	edaRelease?: string; // EDA release this resource belongs to
}

export interface CrdVersionsMap {
	[group: string]: CrdResource[];
}

type JSONType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';

export interface BaseSchema {
	description?: string;
	default?: unknown;
	format?: string;
	enum?: string[];
	minimum?: number;
	maximum?: number;
	type: JSONType;
}

export interface ObjectSchema extends BaseSchema {
	type: 'object';
	properties: {
		[key: string]: Schema;
	};
	required?: string[];
}

export interface ArraySchema extends BaseSchema {
	type: 'array';
	items: Schema;
	minItems?: number;
	maxItems?: number;
}

export interface PrimitiveSchema extends BaseSchema {
	type: Exclude<JSONType, 'object' | 'array'>;
}

export type Schema = ObjectSchema | ArraySchema | PrimitiveSchema;

export interface OpenAPISchema {
	name: string;
	deprecated: boolean;
	schema: {
		openAPIV3Schema: {
			properties: {
				spec: Schema;
				status: Schema;
			};
		};
	};
}

export interface VersionSchema {
	[key: string]: {
		spec: Schema;
		status: Schema;
		deprecated: boolean;
	};
}

export interface EdaRelease {
	name: string; // "latest", "24.11", "24.10"
	label: string; // "Latest", "EDA 24.11", "EDA 24.10"
	folder: string; // "resources", "resources-24.11", "resources-24.10"
	default?: boolean; // Is this the default release?
}

export interface ReleasesConfig {
	releases: EdaRelease[];
}
