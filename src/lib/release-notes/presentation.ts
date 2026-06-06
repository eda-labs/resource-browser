import type { BreakingChange, ModifiedResource } from './types';

export function filterBreakingChanges(
	items: BreakingChange[],
	query: string
): BreakingChange[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(
		(b) =>
			b.kind.toLowerCase().includes(q) ||
			b.field.toLowerCase().includes(q) ||
			b.description.toLowerCase().includes(q)
	);
}

export function groupBreakingByKind(
	items: BreakingChange[]
): Array<{ kind: string; items: BreakingChange[] }> {
	const map = new Map<string, BreakingChange[]>();
	for (const item of items) {
		const list = map.get(item.kind) ?? [];
		list.push(item);
		map.set(item.kind, list);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([kind, groupItems]) => ({ kind, items: groupItems }));
}

export function filterModifiedResources(
	resources: ModifiedResource[],
	query: string
): ModifiedResource[] {
	const q = query.trim().toLowerCase();
	if (!q) return resources;
	return resources
		.map((r) => ({
			...r,
			changes: r.changes.filter(
				(c) =>
					r.kind.toLowerCase().includes(q) ||
					c.field.toLowerCase().includes(q) ||
					c.changeType.toLowerCase().includes(q)
			)
		}))
		.filter((r) => r.changes.length > 0);
}

export function groupModifiedByKind(
	resources: ModifiedResource[]
): ModifiedResource[] {
	return [...resources].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function filterNewResources<T extends { kind: string; apiVersion: string }>(
	items: T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(
		(r) => r.kind.toLowerCase().includes(q) || r.apiVersion.toLowerCase().includes(q)
	);
}
