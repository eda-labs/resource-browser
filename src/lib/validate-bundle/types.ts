import type { ParsedDocument } from '$lib/yaml-validation/types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory = 'schema' | 'cross-ref' | 'ordering' | 'eda';

export type BundleIssue = {
	id: string;
	severity: IssueSeverity;
	message: string;
	category: IssueCategory;
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

export type BundleGraphNode = {
	id: string;
	kind: string;
	name: string;
	namespace: string;
	docIndex: number;
};

export type BundleGraphEdge = {
	id: string;
	source: string;
	target: string;
	field: string;
	external: boolean;
};

export type ApplyOrderEntry = {
	order: number;
	resourceId: string;
	kind: string;
	name: string;
	namespace: string;
	docIndex: number;
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
	graph: { nodes: BundleGraphNode[]; edges: BundleGraphEdge[] };
	applyOrder: ApplyOrderEntry[];
};

export type ValidateBundleOptions = {
	yamlInput: string;
	releaseFolder: string;
	releaseLabel: string;
	manifest: import('$lib/yaml-validation/types').ManifestEntry[];
};
