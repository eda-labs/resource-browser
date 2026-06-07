import type { BundleIssue, BundleResource } from './types';

/** EDA-specific manifest rules not covered by CRD schema or Kubernetes validation. */
export function validateEdaRules(_resources: BundleResource[]): BundleIssue[] {
	return [];
}
