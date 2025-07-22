export interface CrdVersionsMap {
  [key: string]: {
    group: string
    kind: string
    versions: string[]
  }
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

export type Schema = ObjectSchema | ArraySchema | PrimitiveSchema;

export interface VersionSchema {
  [key: string]: {
    spec: Schema
    status: Schema
  }
}

export interface OpenAPISchema { 
  name: string;
  schema: { 
    openAPIV3Schema: { 
      properties: { 
        spec: Schema; 
        status: Schema 
      } 
    } 
  } 
}