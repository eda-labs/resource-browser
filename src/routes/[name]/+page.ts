import { error, redirect } from '@sveltejs/kit'

import type { PageLoad } from './$types'
import type { CrdVersionsMap, ReleasesConfig } from '$lib/structure'

import yaml from 'js-yaml'
import res from '$lib/resources.yaml?raw'
import releases from '$lib/releases.yaml?raw'

const crdResources = yaml.load(res)
const resources = crdResources as CrdVersionsMap
const releaseConfig = yaml.load(releases) as ReleasesConfig

export const load: PageLoad = async ({ params, url, fetch }) => {
  const name = params.name
  const rest = name.substring(name.indexOf(".") + 1)

  // Check if a specific release is requested via query parameter
  const requestedRelease = url.searchParams.get('release')
  let selectedRelease = releaseConfig.releases.find(r => r.default) ?? releaseConfig.releases[0]
  
  if (requestedRelease) {
    const foundRelease = releaseConfig.releases.find(r => r.name === requestedRelease)
    if (foundRelease) {
      selectedRelease = foundRelease
    }
  }
  
  const releaseFolder = selectedRelease?.folder ?? 'resources/25.8.2'

  // Load release-specific manifest
  let releaseManifest: any[] = []
  try {
    const manifestResp = await fetch(`/${releaseFolder}/manifest.json`)
    if (manifestResp.ok) {
      releaseManifest = await manifestResp.json()
    }
  } catch (e) {
    console.warn(`Could not load manifest for ${releaseFolder}`)
  }

  // First try to get metadata from resources.yaml
  let crdMeta = resources[rest]?.filter(x => x.name === name) || []
  
  // If not found in resources.yaml, try the release manifest (for "states" resources)
  if (crdMeta.length === 0 && releaseManifest.length > 0) {
    const manifestEntry = releaseManifest.find(x => x.name === name)
    if (manifestEntry) {
      crdMeta = [manifestEntry]
    }
  }
  
  if(crdMeta.length !== 1) {
    throw error(404, "Invalid resource name")
  }

  const version = crdMeta[0].versions[0].name
  const releaseParam = requestedRelease ? `?release=${requestedRelease}` : ''
  throw redirect(307, `/${name}/${version}${releaseParam}`);
}