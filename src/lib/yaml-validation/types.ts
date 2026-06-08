import type { ErrorObject } from 'ajv';

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

export type SuggestedFixField = 'apiVersion' | 'kind' | 'metadata.name' | 'metadata.namespace';

export type SuggestedFix = {
	field: SuggestedFixField;
	value: string;
	line?: number;
};

export type EnrichedError = ErrorObject & {
	docIndex?: number;
	line?: number;
	column?: number;
	resourceLink?: ResourceLink;
	suggestedFix?: SuggestedFix;
};

export type ParsedDocument = {
	data: Record<string, unknown>;
	rawText: string;
	startLine: number;
	index: number;
};

export type ParseError = {
	message: string;
	line?: number;
	column?: number;
	/** 1-based document index in the bundle */
	docIndex: number;
};

export type ParseDocumentsResult =
	| { ok: true; docs: ParsedDocument[] }
	| {
			ok: false;
			message: string;
			line?: number;
			column?: number;
			docs?: ParsedDocument[];
			parseErrors?: ParseError[];
	  };

export type ValidateYamlOptions = {
	yamlInput: string;
	releaseFolder: string;
	releaseLabel: string;
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
