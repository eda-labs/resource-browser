import { error } from '@sveltejs/kit';

import type { PageLoad } from './$types';
import type { CrdVersionsMap, OpenAPISchema, ReleasesConfig } from '$lib/structure';

import yaml from 'js-yaml';
import res from '$lib/resources.yaml?raw';
import releases from '$lib/releases.yaml?raw';

const crdResources = yaml.load(res);
const resources = crdResources as CrdVersionsMap;
const releaseConfig = yaml.load(releases) as ReleasesConfig;
const allReleases = releaseConfig.releases;

export const load: PageLoad = async ({ fetch, params, url }) => {
	// Check if a specific release is requested via query parameter
	const requestedRelease = url.searchParams.get('release');
	let selectedRelease = releaseConfig.releases.find((r) => r.default) ?? releaseConfig.releases[0];

	if (requestedRelease) {
		const foundRelease = releaseConfig.releases.find((r) => r.name === requestedRelease);
		if (foundRelease) {
			selectedRelease = foundRelease;
		}
	}

	const releaseFolder = selectedRelease?.folder ?? 'resources/25.8.2';
	const releaseLabel = selectedRelease?.label ?? selectedRelease?.name ?? '';
	const name = params.name;
	const versionOnFocus = params.version;
	const rest = name.substring(name.indexOf('.') + 1);

	// Load release-specific manifest
	let releaseManifest: any[] = [];
	try {
		const manifestResp = await fetch(`/${releaseFolder}/manifest.json`);
		if (manifestResp.ok) {
			releaseManifest = await manifestResp.json();
		}
	} catch (e) {
		console.warn(`Could not load manifest for ${releaseFolder}, using fallback`);
	}

	// Prefer release manifest entries when available; fallback to static resources.yaml otherwise
	let crdMeta: any[] = [];
	if (releaseManifest.length > 0) {
		const manifestEntry = releaseManifest.find((x) => x.name === name);
		if (manifestEntry) {
			crdMeta = [manifestEntry];
		}
	}

	if (crdMeta.length === 0) {
		// Try to find resource in static resources.yaml as a fallback
		crdMeta = resources[rest]?.filter((x) => x.name === name) || [];
	}

	if (crdMeta.length !== 1) {
		throw error(404, 'Invalid resource name');
	}

	const crdMetaVersion = crdMeta[0].versions.filter((x: any) => x.name === versionOnFocus);
	if (crdMetaVersion.length == 0) {
		throw error(404, 'Invalid version for the resource name');
	}

	try {
		let resp = await fetch(`/${releaseFolder}/${name}/${versionOnFocus}.yaml`);

		if (!resp.ok) {
			resp = await fetch(`/resources/${name}/${versionOnFocus}.yaml`);
		}

		if (!resp.ok) {
			throw error(404, 'Error fetching resource');
		}

		const crdText = await resp.text();
		const crd = yaml.load(crdText) as OpenAPISchema;

		const group = crdMeta[0].group;
		const kind = crdMeta[0].kind;
		const deprecated = crdMetaVersion[0].deprecated;
		const appVersion = 'appVersion' in crdMetaVersion[0] ? crdMetaVersion[0].appVersion : '';

		// Get valid versions for this resource from the manifest (release-specific)
		// Fall back to crdMeta if manifest doesn't have it
		const manifestResource = releaseManifest.find((r: any) => r.name === name);
		const validVersions =
			manifestResource?.versions?.map((v: any) => v.name) ||
			crdMeta[0].versions.map((x: any) => x.name);

		const spec = crd.schema.openAPIV3Schema.properties.spec;
		const status = crd.schema.openAPIV3Schema.properties.status;
		// Determine earliest release in which this specific version is marked deprecated.
		// For LCP optimization: avoid fetching manifest.json across all releases during SSR
		// (which can add significant latency) — instead, derive `deprecatedSince` from the
		// current releaseManifest or fallback data, and compute a full deprecation history
		// lazily on the client if needed.
		let deprecatedSince: string | null = null;
		// Use the releaseManifest (selected release) if it marks the version deprecated.
		// If the selected release marks it deprecated, compute the earliest release
		// in allReleases where the version was first marked deprecated by iterating
		// releases in chronological order (old -> new).
		const manifestEntry = releaseManifest.find((r: any) => r.name === name);
		const manifestVersion = manifestEntry?.versions?.find((v: any) => v.name === versionOnFocus);
		if (manifestVersion && manifestVersion.deprecated) {
			// Iterate the releases from oldest to newest so we find the FIRST release
			// where the `deprecated` flag becomes true for this version.
			const sortedReleases = (allReleases || []).slice(0).reverse();
			for (const r of sortedReleases) {
				try {
					const resp = await fetch(`/${r.folder}/manifest.json`);
					if (!resp.ok) continue;
					const manifest = await resp.json();
					const entry = manifest.find((x: any) => x.name === name);
					if (!entry || !entry.versions) continue;
					const v = entry.versions.find((vv: any) => vv.name === versionOnFocus);
					if (v && v.deprecated) {
						deprecatedSince = r.label || r.name || null;
						break;
					}
				} catch (e) {
					// ignore fetch errors for a given release and continue
					continue;
				}
			}
			// Fallback: if we couldn't find an earlier release (rare), use the selected release label
			if (!deprecatedSince) deprecatedSince = selectedRelease.label || selectedRelease.name || null;
		}
		return {
			name,
			versionOnFocus,
			kind,
			group,
			deprecated,
			appVersion,
			validVersions,
			spec,
			status,
			releaseLabel,
			releaseFolder,
			allReleases,
			releaseManifest,
			deprecatedSince
		};
	} catch (e) {
		throw error(404, 'Error fetching resource' + e);
	}
};
