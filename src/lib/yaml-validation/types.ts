import type { ErrorObject } from 'ajv';

export type ValidationMode = 'declared' | 'latest';

export type ValidationSummary = {
	totalDocs: number;
	docsWithErrors: number;
	docsWithWarnings: number;
	validDocs: number;
	totalErrors: number;
	totalWarnings: number;
};

export type ResourceLink = {
	name: string;
	version: string;
};

export type EnrichedError = ErrorObject & {
	docIndex?: number;
	line?: number;
	column?: number;
	resourceLink?: ResourceLink;
};

export type ParsedDocument = {
	data: Record<string, unknown>;
	rawText: string;
	startLine: number;
	index: number;
};

export type ParseDocumentsResult =
	| { ok: true; docs: ParsedDocument[] }
	| { ok: false; message: string; line?: number; column?: number };

export type ValidateYamlOptions = {
	yamlInput: string;
	releaseFolder: string;
	releaseLabel: string;
	mode: ValidationMode;
	manifest: ManifestEntry[];
};

export type ManifestEntry = {
	name: string;
	kind?: string;
	group?: string;
	versions?: { name: string; deprecated?: boolean }[];
};

export type ValidateYamlResult = {
	valid: boolean;
	errors: EnrichedError[];
	warnings: EnrichedError[];
	summary: ValidationSummary | null;
	parsedDocs: ParsedDocument[];
};
