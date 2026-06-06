import type { CrdResource } from '$lib/structure';

export type SearchableResource = Pick<CrdResource, 'name' | 'kind' | 'group'>;

export function displayKind(resource: SearchableResource): string {
	return resource.kind || resource.name.split('.')[0];
}

export function displayGroup(resource: SearchableResource): string {
	return resource.group || resource.name.split('.').slice(1).join('.');
}

export function resourceSearchHaystack(resource: SearchableResource): string {
	const kind = displayKind(resource);
	const group = displayGroup(resource);
	return `${resource.name} ${kind} ${group}`.toLowerCase();
}

export function matchesResourceQuery(resource: SearchableResource, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	const terms = q.split(/\s+/);
	const haystack = resourceSearchHaystack(resource);
	return terms.every((term) => haystack.includes(term));
}

/** Higher scores surface exact kind / short-name matches before incidental group hits. */
export function scoreResourceQueryMatch(resource: SearchableResource, query: string): number {
	const q = query.trim().toLowerCase();
	if (!q || !matchesResourceQuery(resource, query)) return -1;

	const terms = q.split(/\s+/);
	const kind = displayKind(resource).toLowerCase();
	const shortName = resource.name.split('.')[0].toLowerCase();
	const group = displayGroup(resource).toLowerCase();
	const name = resource.name.toLowerCase();

	let score = 0;

	for (const term of terms) {
		if (kind === term) score += 1000;
		else if (kind.startsWith(term)) score += 500;
		else if (kind.includes(term)) score += 100;

		if (shortName === term) score += 800;
		else if (shortName.startsWith(term)) score += 400;
		else if (shortName.includes(term)) score += 50;

		if (group === term) score += 100;
		else if (group.includes(term)) score += 10;

		if (name.includes(term)) score += 1;
	}

	score -= name.length * 0.01;

	return score;
}

export function searchResources<T extends SearchableResource>(
	resources: T[],
	query: string,
	options?: { limit?: number }
): T[] {
	const q = query.trim();
	if (!q) return [];

	const results = resources
		.filter((resource) => matchesResourceQuery(resource, q))
		.map((resource) => ({ resource, score: scoreResourceQueryMatch(resource, q) }))
		.sort(
			(a, b) =>
				b.score - a.score || a.resource.name.localeCompare(b.resource.name)
		)
		.map(({ resource }) => resource);

	const limit = options?.limit;
	return limit !== undefined ? results.slice(0, limit) : results;
}
