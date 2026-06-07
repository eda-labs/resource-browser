import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import type { BundleIssue, BundleResource } from './types';

const EDA_LABEL_PREFIXES = ['app.eda.nokia.com/', 'eda.nokia.com/'];
const EDA_API_GROUP_PATTERN = /\.eda\.nokia\.com$/;

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `eda-${issueCounter}`;
}

function lineForField(doc: BundleResource['doc'], fieldPath: string): number | undefined {
	const rel = findLineForPointerInDoc(doc.rawText, fieldPath);
	return rel !== undefined ? doc.startLine + rel + 1 : doc.startLine + 1;
}

export function validateEdaRules(
	resources: BundleResource[],
	releaseLabel: string
): BundleIssue[] {
	issueCounter = 0;
	const issues: BundleIssue[] = [];

	for (const res of resources) {
		const metadata = (res.data.metadata || {}) as Record<string, unknown>;
		const labels = (metadata.labels || {}) as Record<string, string>;

		const hasEdaLabel = Object.keys(labels).some((k) =>
			EDA_LABEL_PREFIXES.some((p) => k.startsWith(p))
		);
		if (!hasEdaLabel && res.kind && res.kind !== 'List') {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'eda',
				message: `Missing eda.nokia.com label on ${res.kind} "${res.name}" — consider app.eda.nokia.com/managed or similar`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/metadata/labels')
			});
		}

		if (res.data.spec && res.data.status) {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'eda',
				message: `${res.kind} "${res.name}" includes both spec and status — status is normally populated by the controller, not applied manifests`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/status')
			});
		}

		if (res.group && !EDA_API_GROUP_PATTERN.test(res.group)) {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'eda',
				message: `apiVersion group "${res.group}" does not match the usual *.eda.nokia.com pattern for Nokia EDA CRDs`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/apiVersion')
			});
		}

		if (res.version === 'v1alpha1') {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'eda',
				message: `${res.kind} "${res.name}" uses apiVersion ${res.apiVersion} — v1alpha1 is often deprecated; check ${releaseLabel} for stable versions`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/apiVersion')
			});
		}

		if (res.name && !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(res.name)) {
			issues.push({
				id: nextIssueId(),
				severity: 'info',
				category: 'eda',
				message: `Resource name "${res.name}" should follow DNS subdomain naming (lowercase, hyphens)`,
				resourceName: res.name,
				resourceKind: res.kind,
				docIndex: res.docIndex + 1,
				line: lineForField(res.doc, '/metadata/name')
			});
		}
	}

	return issues;
}
