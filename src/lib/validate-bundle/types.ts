import type { ParsedDocument } from '$lib/yaml-validation/types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory = 'schema' | 'eda' | 'kubernetes';

/** Sub-type for EDA manifest rules not covered by CRD schema validation. */
export type EdaIssueRule = never;

/** Sub-type for standard Kubernetes manifest requirements. */
export type K8sIssueRule =
	| 'required-apiVersion'
	| 'invalid-apiVersion-format'
	| 'required-kind'
	| 'invalid-root'
	| 'invalid-metadata-type'
	| 'required-metadata-name'
	| 'invalid-metadata-name'
	| 'required-metadata-namespace'
	| 'invalid-metadata-namespace'
	| 'invalid-label-key'
	| 'invalid-label-value'
	| 'invalid-annotation-key'
	| 'spec-with-status';

export type SuggestedFixField = 'apiVersion' | 'kind' | 'metadata.name' | 'metadata.namespace';

export type SuggestedFix = {
	field: SuggestedFixField;
	value: string;
	line?: number;
};

export type BundleIssue = {
	id: string;
	severity: IssueSeverity;
	message: string;
	category: IssueCategory;
	/** EDA rule identifier when category is `eda`. */
	rule?: EdaIssueRule | K8sIssueRule;
	resourceName?: string;
	resourceKind?: string;
	docIndex?: number;
	line?: number;
	fieldPath?: string;
	/** When set, the issue can be auto-fixed in the editor. */
	suggestedFix?: SuggestedFix;
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
