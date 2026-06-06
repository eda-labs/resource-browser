import type { ApplyOrderEntry, BundleGraphEdge, BundleIssue, BundleResource } from './types';
import type { CrossRef } from './crossRefValidator';

let issueCounter = 0;

function nextIssueId(): string {
	issueCounter += 1;
	return `ordering-${issueCounter}`;
}

function resourceById(resources: BundleResource[], id: string): BundleResource | undefined {
	return resources.find((r) => r.id === id);
}

/** Topological sort for safe apply order; dependencies first. */
export function computeApplyOrder(
	resources: BundleResource[],
	edges: BundleGraphEdge[],
	refs: CrossRef[]
): { applyOrder: ApplyOrderEntry[]; issues: BundleIssue[] } {
	issueCounter = 0;
	const issues: BundleIssue[] = [];

	const inBundleEdges = edges.filter((e) => !e.external && !e.target.startsWith('external:'));
	const nodeIds = new Set(resources.map((r) => r.id));

	const adj = new Map<string, Set<string>>();
	const inDegree = new Map<string, number>();

	for (const id of nodeIds) {
		adj.set(id, new Set());
		inDegree.set(id, 0);
	}

	for (const edge of inBundleEdges) {
		if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
		if (edge.source === edge.target) continue;
		const deps = adj.get(edge.target)!;
		if (!deps.has(edge.source)) {
			deps.add(edge.source);
			inDegree.set(edge.source, (inDegree.get(edge.source) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	queue.sort((a, b) => {
		const ra = resourceById(resources, a);
		const rb = resourceById(resources, b);
		return (ra?.docIndex ?? 0) - (rb?.docIndex ?? 0);
	});

	const sorted: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		sorted.push(id);
		const dependents = adj.get(id);
		if (dependents) {
			for (const dependent of dependents) {
				const next = (inDegree.get(dependent) ?? 1) - 1;
				inDegree.set(dependent, next);
				if (next === 0) queue.push(dependent);
			}
		}
		queue.sort((a, b) => {
			const ra = resourceById(resources, a);
			const rb = resourceById(resources, b);
			return (ra?.docIndex ?? 0) - (rb?.docIndex ?? 0);
		});
	}

	if (sorted.length < resources.length) {
		for (const res of resources) {
			if (!sorted.includes(res.id)) sorted.push(res.id);
		}
		issues.push({
			id: nextIssueId(),
			severity: 'warning',
			category: 'ordering',
			message: 'Circular dependency detected — apply order may require manual review'
		});
	}

	for (const ref of refs) {
		const source = resources.find((r) => r.id === ref.sourceId);
		const target = resources.find(
			(r) =>
				r.name === ref.targetName &&
				r.kind === ref.targetKind &&
				r.namespace === ref.namespace
		);
		if (!source || !target) continue;
		if (source.docIndex < target.docIndex) {
			issues.push({
				id: nextIssueId(),
				severity: 'warning',
				category: 'ordering',
				message: `${source.kind} "${source.name}" references ${target.kind} "${target.name}" but appears before it in the bundle`,
				resourceName: source.name,
				resourceKind: source.kind,
				docIndex: source.docIndex + 1,
				line: ref.line,
				fieldPath: ref.fieldPath
			});
		}
	}

	const applyOrder: ApplyOrderEntry[] = sorted.map((id, i) => {
		const res = resourceById(resources, id)!;
		return {
			order: i + 1,
			resourceId: id,
			kind: res.kind,
			name: res.name,
			namespace: res.namespace,
			docIndex: res.docIndex + 1
		};
	});

	if (applyOrder.length > 0) {
		issues.push({
			id: nextIssueId(),
			severity: 'info',
			category: 'ordering',
			message: `Recommended apply order: ${applyOrder.map((e) => `${e.kind}/${e.name}`).join(' → ')}`
		});
	}

	return { applyOrder, issues };
}

export function buildGraphNodes(resources: BundleResource[]) {
	return resources.map((r) => ({
		id: r.id,
		kind: r.kind,
		name: r.name,
		namespace: r.namespace,
		docIndex: r.docIndex + 1
	}));
}
