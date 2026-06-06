import { parseBundleResources } from './parser';
import { validateBundleSchema } from './schemaValidator';
import { validateCrossReferences } from './crossRefValidator';
import { computeApplyOrder, buildGraphNodes } from './ordering';
import { validateEdaRules } from './edaRules';
import type {
	BundleIssue,
	BundleValidationResult,
	BundleValidationSummary,
	ValidateBundleOptions
} from './types';

export * from './types';
export { EXAMPLE_BUNDLE_YAML } from './exampleBundle';
export { kindColor } from './kindColors';

function buildSummary(issues: BundleIssue[], resourceCount: number): BundleValidationSummary {
	return {
		resourceCount,
		errorCount: issues.filter((i) => i.severity === 'error').length,
		warningCount: issues.filter((i) => i.severity === 'warning').length,
		infoCount: issues.filter((i) => i.severity === 'info').length
	};
}

export async function validateBundle(options: ValidateBundleOptions): Promise<BundleValidationResult> {
	const { yamlInput, releaseFolder, releaseLabel, manifest } = options;

	if (!yamlInput.trim()) {
		return {
			valid: true,
			issues: [],
			summary: { resourceCount: 0, errorCount: 0, warningCount: 0, infoCount: 0 },
			resources: [],
			graph: { nodes: [], edges: [] },
			applyOrder: []
		};
	}

	const parsed = parseBundleResources(yamlInput);
	if (!parsed.ok) {
		const issue: BundleIssue = {
			id: 'parse-1',
			severity: 'error',
			category: 'schema',
			message: parsed.message,
			line: parsed.line
		};
		return {
			valid: false,
			issues: [issue],
			summary: buildSummary([issue], 0),
			resources: [],
			graph: { nodes: [], edges: [] },
			applyOrder: []
		};
	}

	const { resources } = parsed;

	const schemaIssues = await validateBundleSchema(
		yamlInput,
		resources,
		releaseFolder,
		releaseLabel,
		manifest
	);
	const crossRef = validateCrossReferences(resources);
	const edaIssues = validateEdaRules(resources, releaseLabel);
	const { applyOrder, issues: orderingIssues } = computeApplyOrder(
		resources,
		crossRef.edges,
		crossRef.refs
	);

	const issues = [...schemaIssues, ...crossRef.issues, ...edaIssues, ...orderingIssues];
	const summary = buildSummary(issues, resources.length);
	const valid = summary.errorCount === 0;

	return {
		valid,
		issues,
		summary,
		resources,
		graph: { nodes: buildGraphNodes(resources), edges: crossRef.edges },
		applyOrder
	};
}
