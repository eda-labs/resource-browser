import { parseBundleResources } from './parser';
import { validateBundleSchema } from './schemaValidator';
import { validateEdaRules } from './edaRules';
import type {
	BundleIssue,
	BundleValidationResult,
	BundleValidationSummary,
	ValidateBundleOptions
} from './types';

export * from './types';
export { EXAMPLE_BUNDLE_YAML } from './exampleBundle';

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
			resources: []
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
			resources: []
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
	const edaIssues = validateEdaRules(resources);

	const issues = [...schemaIssues, ...edaIssues];
	const summary = buildSummary(issues, resources.length);
	const valid = summary.errorCount === 0;

	return {
		valid,
		issues,
		summary,
		resources
	};
}
