import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import type { BundleIssue, BundleResource, K8sIssueRule } from './types';

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `k8s-${issueCounter}`;
}

/** RFC 1123 DNS label: lowercase alphanumeric and hyphens, max 63 chars. */
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_LABEL_MAX = 63;

/** RFC 1123 DNS subdomain: dot-separated labels, max 253 chars. */
const DNS_SUBDOMAIN =
	/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_SUBDOMAIN_MAX = 253;

/** Qualified name segment used in label and annotation keys. */
const QUALIFIED_NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
const QUALIFIED_NAME_MAX = 63;
const LABEL_KEY_MAX = 253;
const LABEL_VALUE_MAX = 63;

function lineForField(doc: BundleResource['doc'], fieldPath: string): number | undefined {
	const pointer = fieldPath.startsWith('/') ? fieldPath : `/${fieldPath.replace(/\./g, '/')}`;
	const rel = findLineForPointerInDoc(doc.rawText, pointer);
	return rel !== undefined ? doc.startLine + rel + 1 : doc.startLine + 1;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isValidApiVersion(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (!trimmed.includes('/')) {
		return /^v[0-9]+[a-z0-9]*$/i.test(trimmed);
	}
	const parts = trimmed.split('/');
	if (parts.length !== 2) return false;
	const [group, version] = parts;
	return group.length > 0 && version.length > 0;
}

export function isValidDnsSubdomain(value: string): boolean {
	return value.length <= DNS_SUBDOMAIN_MAX && DNS_SUBDOMAIN.test(value);
}

export function isValidDnsLabel(value: string): boolean {
	return value.length <= DNS_LABEL_MAX && DNS_LABEL.test(value);
}

/** Normalize a single DNS label segment: underscores to hyphens, lowercase, collapse hyphens. */
function normalizeDnsLabelSegment(segment: string): string {
	return segment
		.replace(/_/g, '-')
		.toLowerCase()
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Auto-fix metadata.name when fixable (underscores, case, hyphen runs). Returns null if unchanged or unfixable. */
export function tryFixDnsSubdomain(value: string): string | null {
	if (isValidDnsSubdomain(value)) return null;
	const fixed = value
		.split('.')
		.map(normalizeDnsLabelSegment)
		.filter((s) => s.length > 0)
		.join('.');
	if (!fixed || fixed === value || !isValidDnsSubdomain(fixed)) return null;
	return fixed;
}

/** Auto-fix metadata.namespace when fixable. Returns null if unchanged or unfixable. */
export function tryFixDnsLabel(value: string): string | null {
	if (isValidDnsLabel(value)) return null;
	const fixed = normalizeDnsLabelSegment(value);
	if (!fixed || fixed === value || !isValidDnsLabel(fixed)) return null;
	return fixed;
}

function isValidLabelKey(key: string): boolean {
	if (key.length > LABEL_KEY_MAX) return false;
	const slash = key.indexOf('/');
	if (slash === -1) {
		return key.length <= QUALIFIED_NAME_MAX && QUALIFIED_NAME.test(key);
	}
	if (slash === 0 || slash === key.length - 1) return false;
	const prefix = key.slice(0, slash);
	const name = key.slice(slash + 1);
	return (
		isValidDnsSubdomain(prefix) &&
		name.length <= QUALIFIED_NAME_MAX &&
		QUALIFIED_NAME.test(name)
	);
}

function isValidLabelValue(value: string): boolean {
	if (value.length > LABEL_VALUE_MAX) return false;
	if (value === '') return true;
	return /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/.test(value);
}

function pushIssue(
	issues: BundleIssue[],
	res: BundleResource,
	rule: K8sIssueRule,
	severity: BundleIssue['severity'],
	message: string,
	fieldPath?: string,
	suggestedFix?: BundleIssue['suggestedFix']
): void {
	const line = fieldPath ? lineForField(res.doc, fieldPath) : res.doc.startLine + 1;
	issues.push({
		id: nextIssueId(),
		severity,
		category: 'kubernetes',
		rule,
		message,
		resourceName: res.name,
		resourceKind: res.kind,
		docIndex: res.docIndex + 1,
		line,
		fieldPath,
		suggestedFix: suggestedFix ? { ...suggestedFix, line: suggestedFix.line ?? line } : undefined
	});
}

function validateLabelMap(
	issues: BundleIssue[],
	res: BundleResource,
	map: Record<string, unknown> | undefined,
	fieldPrefix: 'metadata.labels' | 'metadata.annotations',
	rulePrefix: 'invalid-label' | 'invalid-annotation'
): void {
	if (!map || typeof map !== 'object' || Array.isArray(map)) return;

	for (const [key, value] of Object.entries(map)) {
		const keyPath = `${fieldPrefix}.${key}`;
		if (!isValidLabelKey(key)) {
			pushIssue(
				issues,
				res,
				`${rulePrefix}-key`,
				'error',
				`${keyPath} has an invalid key format (RFC 1123 label key rules apply)`,
				keyPath
			);
		}
		if (rulePrefix === 'invalid-label' && typeof value === 'string' && !isValidLabelValue(value)) {
			pushIssue(
				issues,
				res,
				'invalid-label-value',
				'error',
				`${keyPath} value exceeds ${LABEL_VALUE_MAX} characters or contains invalid characters`,
				keyPath
			);
		}
	}
}

export function validateK8sDocument(res: BundleResource): BundleIssue[] {
	const issues: BundleIssue[] = [];
	const data = res.data;

	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		pushIssue(
			issues,
			res,
			'invalid-root',
			'error',
			'Manifest root must be a YAML mapping (object)',
			undefined
		);
		return issues;
	}

	const apiVersion = data.apiVersion;
	if (apiVersion === undefined || apiVersion === null) {
		pushIssue(
			issues,
			res,
			'required-apiVersion',
			'error',
			"Missing required 'apiVersion' field",
			'apiVersion'
		);
	} else if (!isNonEmptyString(apiVersion)) {
		pushIssue(
			issues,
			res,
			'required-apiVersion',
			'error',
			'apiVersion must be a non-empty string',
			'apiVersion'
		);
	} else if (!isValidApiVersion(apiVersion)) {
		pushIssue(
			issues,
			res,
			'invalid-apiVersion-format',
			'error',
			`Invalid apiVersion format: '${apiVersion}' (expected 'group/version' or core version such as 'v1')`,
			'apiVersion'
		);
	}

	const kind = data.kind;
	if (kind === undefined || kind === null) {
		pushIssue(
			issues,
			res,
			'required-kind',
			'error',
			"Missing required 'kind' field",
			'kind'
		);
	} else if (!isNonEmptyString(kind)) {
		pushIssue(
			issues,
			res,
			'required-kind',
			'error',
			'kind must be a non-empty string',
			'kind'
		);
	}

	const metadata = data.metadata;
	if (metadata === undefined || metadata === null) {
		pushIssue(
			issues,
			res,
			'invalid-metadata-type',
			'error',
			"Missing required 'metadata' field",
			'metadata'
		);
	} else if (typeof metadata !== 'object' || Array.isArray(metadata)) {
		pushIssue(
			issues,
			res,
			'invalid-metadata-type',
			'error',
			'metadata must be an object',
			'metadata'
		);
	} else {
		const meta = metadata as Record<string, unknown>;
		const name = meta.name;
		if (name === undefined || name === null || (typeof name === 'string' && name.trim() === '')) {
			pushIssue(
				issues,
				res,
				'required-metadata-name',
				'error',
				"Missing required 'metadata.name' field",
				'metadata.name'
			);
		} else if (typeof name === 'string' && !isValidDnsSubdomain(name)) {
			const fixedName = tryFixDnsSubdomain(name);
			pushIssue(
				issues,
				res,
				'invalid-metadata-name',
				'error',
				'metadata.name must be a valid DNS subdomain (lowercase alphanumeric, hyphens, dots; max 253 characters)',
				'metadata.name',
				fixedName ? { field: 'metadata.name', value: fixedName } : undefined
			);
		}

		const namespace = meta.namespace;
		if (
			namespace === undefined ||
			namespace === null ||
			(typeof namespace === 'string' && namespace.trim() === '')
		) {
			pushIssue(
				issues,
				res,
				'required-metadata-namespace',
				'error',
				'metadata.namespace is required',
				'metadata.namespace'
			);
		} else if (typeof namespace === 'string' && !isValidDnsLabel(namespace)) {
			const fixedNamespace = tryFixDnsLabel(namespace);
			pushIssue(
				issues,
				res,
				'invalid-metadata-namespace',
				'error',
				'metadata.namespace must be a valid DNS label (lowercase alphanumeric and hyphens; max 63 characters)',
				'metadata.namespace',
				fixedNamespace ? { field: 'metadata.namespace', value: fixedNamespace } : undefined
			);
		}

		if (meta.labels !== undefined) {
			if (typeof meta.labels !== 'object' || meta.labels === null || Array.isArray(meta.labels)) {
				pushIssue(
					issues,
					res,
					'invalid-label-key',
					'error',
					'metadata.labels must be an object',
					'metadata.labels'
				);
			} else {
				validateLabelMap(
					issues,
					res,
					meta.labels as Record<string, unknown>,
					'metadata.labels',
					'invalid-label'
				);
			}
		}

		if (meta.annotations !== undefined) {
			if (
				typeof meta.annotations !== 'object' ||
				meta.annotations === null ||
				Array.isArray(meta.annotations)
			) {
				pushIssue(
					issues,
					res,
					'invalid-annotation-key',
					'error',
					'metadata.annotations must be an object',
					'metadata.annotations'
				);
			} else {
				validateLabelMap(
					issues,
					res,
					meta.annotations as Record<string, unknown>,
					'metadata.annotations',
					'invalid-annotation'
				);
			}
		}
	}

	if (data.spec && data.status) {
		pushIssue(
			issues,
			res,
			'spec-with-status',
			'warning',
			`${res.kind || 'Resource'} "${res.name}" includes both spec and status — status is normally populated by the controller, not applied manifests`,
			'status'
		);
	}

	return issues;
}

export function validateK8sRules(resources: BundleResource[]): BundleIssue[] {
	issueCounter = 0;
	return resources.flatMap((res) => validateK8sDocument(res));
}

/** Schema issues that duplicate k8sRules structural checks — CRD resolution errors are kept. */
export function isK8sStructuralSchemaIssue(issue: BundleIssue): boolean {
	if (issue.category !== 'schema') return false;

	const msg = issue.message;
	if (
		msg.includes('Could not find CRD definition') ||
		msg.includes('Could not find CRD for apiVersion') ||
		msg.includes('Invalid apiVersion:') ||
		msg.includes('Invalid kind:') ||
		msg.includes('kind must match CRD exactly') ||
		msg.includes('is not supported for apiVersion') ||
		msg.includes('is not supported for kind') ||
		msg.includes('Could not find schema for') ||
		msg.includes('No API versions found for kind') ||
		msg.includes('is deprecated for kind') ||
		msg.includes('is not the latest for kind')
	) {
		return false;
	}

	const path = issue.fieldPath || '';
	if (
		path === 'metadata' ||
		path === '/metadata' ||
		path === 'metadata.name' ||
		path === '/metadata/name' ||
		path === 'metadata.namespace' ||
		path === '/metadata/namespace' ||
		path.startsWith('metadata.labels') ||
		path.startsWith('/metadata/labels') ||
		path.startsWith('metadata.annotations') ||
		path.startsWith('/metadata/annotations')
	) {
		return true;
	}

	return (
		msg.includes("Missing required 'apiVersion'") ||
		msg.includes("Missing required 'kind'") ||
		msg.includes("Missing required 'metadata") ||
		msg.includes('metadata.name must be a valid DNS subdomain') ||
		msg.includes('Invalid apiVersion format')
	);
}
