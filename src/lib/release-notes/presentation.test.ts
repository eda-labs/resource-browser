import { describe, expect, it } from 'vitest';
import {
	breakingProductionImpact,
	deriveGroupFromApiVersion,
	displayNetworkBehavior,
	filterDeprecatedItems,
	groupModifiedByOperationalArea,
	groupNewResourcesByKind,
	groupNewResourcesByOperationalArea,
	highlightSegments,
	humanizeFieldPath,
	inferOperationalArea,
	isPresentationMetadataField,
	partitionFieldChanges
} from './presentation';
import type { NewResource } from './types';
import type { BreakingChange, FieldChange, ModifiedResource } from './types';

describe('presentation', () => {
	it('humanizes common network field paths', () => {
		expect(humanizeFieldPath('spec.addressFamily')).toBe('BGP address-family declaration');
		expect(humanizeFieldPath('spec.interfaceSelectors')).toBe('interface selector rules');
	});

	it('classifies schema metadata for presentation filtering', () => {
		expect(isPresentationMetadataField('spec.label.description')).toBe(true);
		expect(isPresentationMetadataField('spec.content.items.x-kubernetes-validations')).toBe(true);
		expect(isPresentationMetadataField('spec.bgp.holdTime')).toBe(false);
	});

	it('partitions operational vs metadata changes', () => {
		const changes: FieldChange[] = [
			{
				field: 'spec.holdTime',
				changeType: 'required_added',
				before: '',
				after: '',
				networkBehavior: ''
			},
			{
				field: 'spec.label.description',
				changeType: 'type_change',
				before: 'a',
				after: 'b',
				networkBehavior: ''
			}
		];
		const { operational, metadata } = partitionFieldChanges(changes);
		expect(operational).toHaveLength(1);
		expect(metadata).toHaveLength(1);
	});

	it('groups modified resources by operational area', () => {
		const resources: ModifiedResource[] = [
			{ kind: 'BGPPeer', changes: [] },
			{ kind: 'FabricLink', changes: [] }
		];
		const grouped = groupModifiedByOperationalArea(resources);
		expect(grouped.map((g) => g.area)).toContain('BGP');
		expect(grouped.map((g) => g.area)).toContain('Topology');
	});

	it('builds production impact one-liners', () => {
		const change: BreakingChange = {
			kind: 'Init',
			field: 'spec.mgmt.properties.interface.required',
			description: 'required',
			severity: 'critical',
			migrationSteps: [],
			yamlBefore: '',
			yamlAfter: ''
		};
		expect(breakingProductionImpact(change)).toMatch(/fail in production/i);
	});

	it('enriches network behavior from change type', () => {
		const change: FieldChange = {
			field: 'spec.addressFamily',
			changeType: 'required_added',
			before: '',
			after: '',
			networkBehavior: ''
		};
		expect(displayNetworkBehavior(change, 'BGPPeer')).toMatch(/fail reconciliation/i);
	});

	it('highlights search matches', () => {
		const segments = highlightSegments('BGPPeer session hold', 'hold');
		expect(segments.some((s) => s.match && s.text === 'hold')).toBe(true);
	});

	it('filters deprecated items by recommended apiVersion', () => {
		const items = filterDeprecatedItems(
			[
				{
					kind: 'ClusterExport',
					group: 'nats.eda.nokia.com',
					crdName: 'clusterexports.nats.eda.nokia.com',
					recommendedApiVersion: 'nats.eda.nokia.com/v1',
					migrationPath: 'migrate',
					deprecatedVersions: []
				}
			],
			'nats.eda.nokia.com/v1'
		);
		expect(items).toHaveLength(1);
	});

	it('infers BGP operational area from kind', () => {
		expect(inferOperationalArea('BGPPeer', 'protocols.eda.nokia.com')).toBe('BGP');
	});

	it('derives API group from apiVersion string', () => {
		expect(deriveGroupFromApiVersion('protocols.eda.nokia.com/v2')).toBe(
			'protocols.eda.nokia.com'
		);
	});

	it('merges duplicate kinds into one grouped resource with version chips', () => {
		const items: NewResource[] = [
			{
				kind: 'BGPPeer',
				apiVersion: 'protocols.eda.nokia.com/v1',
				description: 'v1'
			},
			{
				kind: 'BGPPeer',
				apiVersion: 'protocols.eda.nokia.com/v2',
				description: 'v2'
			}
		];
		const grouped = groupNewResourcesByKind(items);
		expect(grouped).toHaveLength(1);
		expect(grouped[0].apiVersions).toHaveLength(2);
		expect(grouped[0].group).toBe('protocols.eda.nokia.com');
	});

	it('groups new resources by operational area then kind', () => {
		const grouped = groupNewResourcesByKind([
			{ kind: 'FabricLink', apiVersion: 'topology.eda.nokia.com/v1', description: 'a' },
			{ kind: 'BGPPeer', apiVersion: 'protocols.eda.nokia.com/v2', description: 'b' }
		]);
		const areas = groupNewResourcesByOperationalArea(grouped);
		expect(areas.map((g) => g.area)).toEqual(['BGP', 'Topology']);
		expect(areas[0].resources[0].kind).toBe('BGPPeer');
	});
});
