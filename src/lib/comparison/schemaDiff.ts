function compareObjects(source: unknown, target: unknown, path = ''): string[] {
	const changes: string[] = [];
	const sourceObj = (source || {}) as Record<string, unknown>;
	const targetObj = (target || {}) as Record<string, unknown>;
	const sourceKeys = new Set(Object.keys(sourceObj));
	const targetKeys = new Set(Object.keys(targetObj));

	for (const key of targetKeys) {
		if (!sourceKeys.has(key)) {
			changes.push(`+ Added: ${path}${key}`);
		}
	}
	for (const key of sourceKeys) {
		if (!targetKeys.has(key)) {
			changes.push(`- Removed: ${path}${key}`);
		}
	}
	for (const key of sourceKeys) {
		if (targetKeys.has(key)) {
			const sourceVal = sourceObj[key];
			const targetVal = targetObj[key];
			if (
				typeof sourceVal === 'object' &&
				typeof targetVal === 'object' &&
				sourceVal !== null &&
				targetVal !== null &&
				!Array.isArray(sourceVal) &&
				!Array.isArray(targetVal)
			) {
				changes.push(...compareObjects(sourceVal, targetVal, `${path}${key}.`));
			} else if (JSON.stringify(sourceVal) !== JSON.stringify(targetVal)) {
				changes.push(`~ Modified: ${path}${key}`);
			}
		}
	}
	return changes;
}

export function compareSchemas(sourceData: Record<string, unknown>, targetData: Record<string, unknown>): string[] {
	const sourceSchema = sourceData.schema as Record<string, unknown> | undefined;
	const targetSchema = targetData.schema as Record<string, unknown> | undefined;
	const sourceOas = sourceSchema?.openAPIV3Schema as Record<string, unknown> | undefined;
	const targetOas = targetSchema?.openAPIV3Schema as Record<string, unknown> | undefined;
	const sourceProps = sourceOas?.properties as Record<string, unknown> | undefined;
	const targetProps = targetOas?.properties as Record<string, unknown> | undefined;

	const specChanges = compareObjects(
		(sourceProps?.spec as Record<string, unknown> | undefined)?.properties,
		(targetProps?.spec as Record<string, unknown> | undefined)?.properties,
		'spec.'
	);
	const statusChanges = compareObjects(
		(sourceProps?.status as Record<string, unknown> | undefined)?.properties,
		(targetProps?.status as Record<string, unknown> | undefined)?.properties,
		'status.'
	);
	return [...specChanges, ...statusChanges];
}
