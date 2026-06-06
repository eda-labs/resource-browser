import { findLineForPointerInDoc } from '$lib/yaml-validation/parseDocuments';
import type { BundleGraphEdge, BundleIssue, BundleResource } from './types';

export type CrossRef = {
	sourceId: string;
	targetName: string;
	targetKind: string;
	fieldPath: string;
	namespace: string;
	line?: number;
	external: boolean;
};

/** Known Ref field suffix → expected target kind. */
const REF_FIELD_KIND: Record<string, string> = {
	topologyRef: 'Topology',
	nodeRef: 'TopoNode',
	interfaceRef: 'Interface',
	networkInstanceRef: 'NetworkInstance',
	routerRef: 'Router',
	bridgeDomainRef: 'BridgeDomain',
	fabricRef: 'Fabric',
	nodeProfile: 'NodeProfile',
	policyRef: 'Policy',
	labelBlockRef: 'LabelBlock'
};

const REF_SUFFIX = /Ref$/i;
const SELECTOR_SUFFIX = /Selector$/i;

function inferKindFromField(fieldName: string): string | null {
	if (fieldName === 'node') return 'TopoNode';
	if (REF_FIELD_KIND[fieldName]) return REF_FIELD_KIND[fieldName];
	const base = fieldName.replace(REF_SUFFIX, '').replace(SELECTOR_SUFFIX, '');
	if (!base || base === fieldName) return null;
	return base.charAt(0).toUpperCase() + base.slice(1);
}

function extractName(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
		if (typeof obj.resourceName === 'string' && obj.resourceName.trim()) {
			return obj.resourceName.trim();
		}
	}
	return null;
}

function walkForRefs(
	obj: unknown,
	path: string,
	namespace: string,
	sourceId: string,
	doc: BundleResource['doc'],
	out: CrossRef[]
): void {
	if (obj === null || obj === undefined) return;

	if (Array.isArray(obj)) {
		obj.forEach((item, i) => walkForRefs(item, `${path}/${i}`, namespace, sourceId, doc, out));
		return;
	}

	if (typeof obj !== 'object') return;
	const record = obj as Record<string, unknown>;

	for (const [key, value] of Object.entries(record)) {
		const fieldPath = path ? `${path}.${key}` : key;
		const isRefLike =
			REF_SUFFIX.test(key) || SELECTOR_SUFFIX.test(key) || key === 'node' || key in REF_FIELD_KIND;

		if (isRefLike) {
			const targetKind = inferKindFromField(key);
			const targetName = extractName(value);
			if (targetKind && targetName) {
				const pointer = `/spec${fieldPath.replace(/\./g, '/')}`;
				const docLine = findLineForPointerInDoc(doc.rawText, pointer);
				const line = docLine !== undefined ? doc.startLine + docLine + 1 : undefined;
				out.push({
					sourceId,
					targetName,
					targetKind,
					fieldPath,
					namespace,
					line,
					external: false
				});
			}
		}

		if (value && typeof value === 'object') {
			walkForRefs(value, fieldPath, namespace, sourceId, doc, out);
		}
	}
}

function buildResourceIndex(resources: BundleResource[]): Map<string, BundleResource> {
	const index = new Map<string, BundleResource>();
	for (const res of resources) {
		index.set(`${res.namespace}/${res.kind}/${res.name}`, res);
		index.set(`${res.namespace}/${res.name}`, res);
		index.set(res.name, res);
	}
	return index;
}

function resolveTarget(
	targetName: string,
	targetKind: string,
	namespace: string,
	index: Map<string, BundleResource>
): BundleResource | null {
	return (
		index.get(`${namespace}/${targetKind}/${targetName}`) ??
		index.get(`${namespace}/${targetName}`) ??
		([...index.values()].find(
			(r) => r.name === targetName && r.kind === targetKind && r.namespace === namespace
		) ??
			null)
	);
}

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `cross-ref-${issueCounter}`;
}

export function validateCrossReferences(resources: BundleResource[]): {
	issues: BundleIssue[];
	edges: BundleGraphEdge[];
	refs: CrossRef[];
} {
	issueCounter = 0;
	const index = buildResourceIndex(resources);
	const refs: CrossRef[] = [];
	const issues: BundleIssue[] = [];
	const edges: BundleGraphEdge[] = [];

	for (const res of resources) {
		const spec = res.data.spec;
		if (!spec || typeof spec !== 'object') continue;
		walkForRefs(spec, 'spec', res.namespace, res.id, res.doc, refs);
	}

	for (const ref of refs) {
		const source = resources.find((r) => r.id === ref.sourceId);
		if (!source) continue;

		const target = resolveTarget(ref.targetName, ref.targetKind, ref.namespace, index);
		const edgeId = `${ref.sourceId}|${ref.targetName}|${ref.fieldPath}`;

		if (target) {
			edges.push({
				id: edgeId,
				source: ref.sourceId,
				target: target.id,
				field: ref.fieldPath,
				external: false
			});
		} else {
			ref.external = true;
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'cross-ref',
				message: `Reference to ${ref.targetKind} "${ref.targetName}" via ${ref.fieldPath} was not found in this bundle`,
				resourceName: source.name,
				resourceKind: source.kind,
				docIndex: source.docIndex + 1,
				line: ref.line,
				fieldPath: ref.fieldPath
			});
			edges.push({
				id: edgeId,
				source: ref.sourceId,
				target: `external:${ref.targetKind}/${ref.targetName}`,
				field: ref.fieldPath,
				external: true
			});
		}
	}

	return { issues, edges, refs };
}
