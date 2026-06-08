import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { describe, expect, it } from 'vitest';
import {
	buildCatalogFromManifest,
	getKindIndex,
	inferCatalogLinks,
	inferSchemaLinks,
	mergeGraphLinks
} from './inferEdges';
import type { CrdResource } from '$lib/structure';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(
	readFileSync(join(root, 'static/resources/26.4.2/manifest.json'), 'utf8')
) as CrdResource[];

const fabricYaml = readFileSync(
	join(root, 'static/resources/26.4.2/fabrics.fabrics.eda.nokia.com/v1.yaml'),
	'utf8'
);
const fabricSchema = loadStaticYaml(fabricYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown; status?: unknown } } };
};

const FABRIC_ID = 'fabrics.fabrics.eda.nokia.com';

describe('inferEdges intent inference', () => {
	it('derives meaningful Fabric dependencies without property-name noise', () => {
		const catalog = buildCatalogFromManifest(manifest);
		const kindIndex = getKindIndex(catalog);
		const catalogLinks = inferCatalogLinks(catalog, kindIndex);
		const schemaLinks = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricSchema.schema?.openAPIV3Schema?.properties?.spec,
			fabricSchema.schema?.openAPIV3Schema?.properties?.status,
			kindIndex,
			catalog
		);

		const fabricLinks = mergeGraphLinks([...catalogLinks, ...schemaLinks]).filter(
			(link) => link.source === FABRIC_ID
		);
		const targets = new Set(fabricLinks.map((link) => link.target));

		expect(fabricLinks.length).toBeGreaterThanOrEqual(8);
		expect(fabricLinks.length).toBeLessThan(30);
		expect(targets.has('fabricstates.fabrics.eda.nokia.com')).toBe(true);
		expect(targets.has('isls.fabrics.eda.nokia.com')).toBe(true);
		expect(targets.has('topolinks.core.eda.nokia.com')).toBe(true);
		expect(targets.has('toponodes.core.eda.nokia.com')).toBe(true);
		expect(targets.has('policys.routingpolicies.eda.nokia.com')).toBe(true);
		expect(targets.has('ipallocationpools.core.eda.nokia.com')).toBe(true);
		expect(targets.has('indexallocationpools.core.eda.nokia.com')).toBe(true);
		expect(targets.has('keychains.security.eda.nokia.com')).toBe(true);

		const observes = fabricLinks.find((link) => link.target.includes('fabricstates'));
		expect(observes?.rel).toBe('observes');
		expect(observes?.reason).toContain('catalog pairing');

		const isl = fabricLinks.find((link) => link.target.includes('isls'));
		expect(isl?.rel).toBe('orchestrates');

		const policy = fabricLinks.find((link) => link.target.includes('policys'));
		expect(policy?.rel).toBe('appliesTo');

		for (const link of fabricLinks) {
			expect(link.reason).toBeTruthy();
			expect(link.confidence).toBeGreaterThanOrEqual(55);
		}
	});

	it('walks status schema for config deps but skips operational-state noise', () => {
		const catalog = buildCatalogFromManifest(manifest);
		const kindIndex = getKindIndex(catalog);
		const statusOnlyLinks = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			undefined,
			fabricSchema.schema?.openAPIV3Schema?.properties?.status,
			kindIndex,
			catalog
		);
		const islFromStatus = statusOnlyLinks.find((link) => link.target.includes('isls'));
		expect(islFromStatus).toBeUndefined();
	});

	it('merges duplicate source-target edges to the strongest intent relation', () => {
		const catalog = buildCatalogFromManifest(manifest);
		const kindIndex = getKindIndex(catalog);
		const links = inferSchemaLinks(
			FABRIC_ID,
			'fabrics.eda.nokia.com',
			fabricSchema.schema?.openAPIV3Schema?.properties?.spec,
			undefined,
			kindIndex,
			catalog
		);

		const policyLinks = links.filter((link) => link.target.includes('policys'));
		expect(policyLinks).toHaveLength(1);
		expect(policyLinks[0]?.rel).toBe('appliesTo');
	});
});
