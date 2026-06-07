import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import type { BundleIssue, BundleResource } from './types';

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `eda-${issueCounter}`;
}

function lineForField(doc: BundleResource['doc'], fieldPath: string): number | undefined {
	const rel = findLineForPointerInDoc(doc.rawText, fieldPath);
	return rel !== undefined ? doc.startLine + rel + 1 : doc.startLine + 1;
}

export function validateEdaRules(resources: BundleResource[]): BundleIssue[] {
	issueCounter = 0;
	const issues: BundleIssue[] = [];

	for (const res of resources) {
		const metadata = (res.data.metadata || {}) as Record<string, unknown>;
		const namespace = metadata.namespace;
		if (
			namespace === undefined ||
			namespace === null ||
			(typeof namespace === 'string' && namespace.trim() === '')
		) {
			issues.push({
				id: nextIssueId(),
				severity: 'error',
				category: 'eda',
				rule: 'required-namespace',
				message: 'metadata.namespace is required',
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/metadata/namespace'),
				fieldPath: 'metadata.namespace'
			});
		}

		if (res.data.spec && res.data.status) {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'eda',
				rule: 'spec-with-status',
				message: `${res.kind} "${res.name}" includes both spec and status — status is normally populated by the controller, not applied manifests`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/status')
			});
		}
	}

	return issues;
}
