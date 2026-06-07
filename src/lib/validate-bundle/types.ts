import type { ParsedDocument } from '$lib/yaml-validation/types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory = 'schema' | 'eda';

/** Sub-type for EDA manifest rules not covered by CRD schema validation. */
export type EdaIssueRule = 'spec-with-status' | 'required-namespace';

export type BundleIssue = {
	id: string;
	severity: IssueSeverity;
	message: string;
	category: IssueCategory;
	/** EDA rule identifier when category is `eda`. */
	rule?: EdaIssueRule;
	resourceName?: string;
	resourceKind?: string;
	docIndex?: number;
	line?: number;
	fieldPath?: string;
};

export type BundleResource = {
	id: string;
	docIndex: number;
	kind: string;
	apiVersion: string;
	group: string;
	version: string;
	name: string;
	namespace: string;
	data: Record<string, unknown>;
	doc: ParsedDocument;
};

export type BundleValidationSummary = {
	resourceCount: number;
	errorCount: number;
	warningCount: number;
	infoCount: number;
};

export type BundleValidationResult = {
	valid: boolean;
	issues: BundleIssue[];
	summary: BundleValidationSummary;
	resources: BundleResource[];
};

export type ValidateBundleOptions = {
	yamlInput: string;
	releaseFolder: string;
	releaseLabel: string;
	manifest: import('$lib/yaml-validation/types').ManifestEntry[];
};
