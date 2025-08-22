import { error } from '@sveltejs/kit'

import type { CrdVersionsMap, OpenAPISchema } from '$lib/structure'

import yaml from 'js-yaml'
import res from '$lib/resources.yaml?raw'

const crdResources = yaml.load(res)
const resources = crdResources as CrdVersionsMap

export async function load({ fetch, params }) {
  const name = params.name
  const versionOnFocus = params.version
  const rest = name.substring(name.indexOf(".") + 1)

  const crdMeta = resources[rest].filter(x => x.name === name)
  if(crdMeta.length !== 1) {
    throw error(404, "Invalid resource name")
  }

  const crdMetaVersion = crdMeta[0].versions.filter(x => x.name === versionOnFocus)
  if(crdMetaVersion.length == 0) {
    throw error(404, "Invalid version for the resource name")
  }

  try {
    const resp = await fetch(`/resources/${name}/${versionOnFocus}.yaml`)
    const crdText = await resp.text()
    const crd = yaml.load(crdText) as OpenAPISchema

    const group = crdMeta[0].group
    const kind = crdMeta[0].kind
    const deprecated = crdMetaVersion[0].deprecated
    const validVersions = crdMeta[0].versions.map(x => x.name)

    const spec = crd.schema.openAPIV3Schema.properties.spec
    const status = crd.schema.openAPIV3Schema.properties.status

    return { name, versionOnFocus, kind, group, deprecated, validVersions, spec, status }
  } catch(e) {
    throw error(404, "Error fetching resource" + e)
  }
}