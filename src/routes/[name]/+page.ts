import { error, redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';
import type { CrdVersionsMap, ReleasesConfig } from '$lib/structure';
import { getLatestVersion } from '$lib/versions';

import { loadStaticYaml } from '$lib/yaml/safeYaml';
import res from '$lib/resources.yaml?raw';
import releases from '$lib/releases.yaml?raw';

const crdResources = loadStaticYaml(res);
const resources = crdResources as CrdVersionsMap;
const releaseConfig = loadStaticYaml(releases) as ReleasesConfig;

export const load: PageLoad = async ({ params, url, fetch }) => {
	const name = params.name;
	const rest = name.substring(name.indexOf('.') + 1);

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

	// Load release-specific manifest
	let releaseManifest: any[] = [];
	try {
		const manifestResp = await fetch(`/${releaseFolder}/manifest.json`);
		if (manifestResp.ok) {
			releaseManifest = await manifestResp.json();
		}
	} catch (e) {
		console.warn(`Could not load manifest for ${releaseFolder}`);
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
		crdMeta = resources[rest]?.filter((x) => x.name === name) || [];
	}

	if (crdMeta.length !== 1) {
		throw error(404, 'Invalid resource name');
	}

	const version = getLatestVersion(crdMeta[0]);
	if (!version) {
		throw error(404, 'No version available for resource');
	}
	const releaseParam = requestedRelease ? `?release=${requestedRelease}` : '';
	throw redirect(307, `/${name}/${version}${releaseParam}`);
};
