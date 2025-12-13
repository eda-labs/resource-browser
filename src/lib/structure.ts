export interface CrdVersions {
  name: string;
  deprecated: boolean;
  appVersion: string;
}

export interface CrdResource {
  name: string;
  group: string;
  kind: string;
  versions: CrdVersions[];
}

export interface CrdVersionsMap {
  [group: string]: CrdResource[];
}

type JSONType = "string" | "integer" | "number" | "boolean" | "object" | "array";

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
  type: "object";
  properties: {
    [key: string]: Schema;
  };
  required?: string[];
}

export interface ArraySchema extends BaseSchema {
  type: "array";
  items: Schema;
}

export interface PrimitiveSchema extends BaseSchema {
  type: Exclude<JSONType, "object" | "array">;
}

export type Schema = ObjectSchema | ArraySchema | PrimitiveSchema | Record<string, any>;

export interface OpenAPISchema {
  name: string;
  deprecated: boolean;
  schema: {
    openAPIV3Schema: {
      properties: {
        spec: Schema;
        status: Schema
      }
    }
  }
}

export interface VersionSchema {
  [key: string]: {
    spec: Schema;
    status: Schema;
    deprecated: boolean;
  }
}