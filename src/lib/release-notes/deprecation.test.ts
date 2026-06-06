import { describe, expect, it } from 'vitest';
import type { ManifestResource } from '$lib/manifest';
import {
	buildDeprecationMigrationPath,
	countDeprecatedApiVersions,
	countNewlyDeprecatedApiVersions,
	fullApiVersion,
	groupDeprecatedByResource,
	recommendedApiVersion,
	resolveResourceKind
} from './deprecation';

const aggregateRoute: ManifestResource = {
	name: 'aggregateroutes.protocols.eda.nokia.com',
	group: 'protocols.eda.nokia.com',
	kind: 'AggregateRoute',
	versions: [
		{ name: 'v1', deprecated: true },
		{ name: 'v1alpha1', deprecated: true },
		{ name: 'v2' }
	]
};

const emptyKindResource: ManifestResource = {
	name: 'alarmoverlays.topologies.eda.nokia.com',
	group: 'topologies.eda.nokia.com',
	kind: '',
	versions: [{ name: 'v1alpha1', deprecated: true }]
};

describe('deprecation helpers', () => {
	it('resolves kind from manifest or short name', () => {
		expect(resolveResourceKind(aggregateRoute)).toBe('AggregateRoute');
		expect(resolveResourceKind(emptyKindResource)).toBe('alarmoverlays');
	});

	it('builds full apiVersion and migration path', () => {
		expect(fullApiVersion(aggregateRoute, 'v1')).toBe('protocols.eda.nokia.com/v1');
		expect(recommendedApiVersion(aggregateRoute)).toBe('protocols.eda.nokia.com/v2');
		expect(buildDeprecationMigrationPath(aggregateRoute, 'protocols.eda.nokia.com/v2')).toBe(
			'Update manifests to apiVersion protocols.eda.nokia.com/v2 (available in the catalog)'
		);
	});

	it('groups deprecated versions by resource', () => {
		const items = groupDeprecatedByResource([
			{
				resource: aggregateRoute,
				versions: [
					{ versionName: 'v1', newInRelease: true },
					{ versionName: 'v1alpha1', newInRelease: false }
				]
			}
		]);

		expect(items).toHaveLength(1);
		expect(items[0].kind).toBe('AggregateRoute');
		expect(items[0].deprecatedVersions.map((v) => v.version)).toEqual(['v1', 'v1alpha1']);
		expect(items[0].deprecatedVersions[0].newInRelease).toBe(true);
		expect(items[0].deprecatedVersions[1].newInRelease).toBe(false);
		expect(items[0].migrationPath).toContain('apiVersion protocols.eda.nokia.com/v2');
		expect(items[0].migrationPath).not.toContain('appVersion');
	});

	it('counts api versions across grouped items', () => {
		const items = groupDeprecatedByResource([
			{
				resource: aggregateRoute,
				versions: [
					{ versionName: 'v1', newInRelease: true },
					{ versionName: 'v1alpha1', newInRelease: false }
				]
			},
			{
				resource: emptyKindResource,
				versions: [{ versionName: 'v1alpha1', newInRelease: true }]
			}
		]);

		expect(countDeprecatedApiVersions(items)).toBe(3);
		expect(countNewlyDeprecatedApiVersions(items)).toBe(2);
	});
});
