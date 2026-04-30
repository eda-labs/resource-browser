import { error, isHttpError } from '@sveltejs/kit'

import { sortApiVersionsNewestFirst } from '$lib/apiVersion'
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

  const resourceUrl = `/resources/${name}/${versionOnFocus}.yaml`
  const resp = await fetch(resourceUrl)
  if (!resp.ok) {
    throw error(
      404,
      `CRD YAML not found (${resp.status}): ${resourceUrl}. Regenerate static/resources (see static/get-crds.sh).`
    )
  }

  const crdText = await resp.text()
  const trimmed = crdText.trimStart()
  if (trimmed.startsWith('<!') || trimmed.toLowerCase().startsWith('<html')) {
    throw error(
      404,
      `CRD YAML missing or misconfigured: ${resourceUrl} returned HTML instead of YAML (static file likely missing).`
    )
  }

  let crd: OpenAPISchema
  try {
    crd = yaml.load(crdText) as OpenAPISchema
  } catch (e) {
    if (isHttpError(e)) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw error(404, `Invalid CRD YAML for ${resourceUrl}: ${msg}`)
  }

  const spec = crd?.schema?.openAPIV3Schema?.properties?.spec
  const status = crd?.schema?.openAPIV3Schema?.properties?.status
  if (spec === undefined || status === undefined) {
    throw error(
      404,
      `CRD YAML for ${resourceUrl} does not define spec/status schema under schema.openAPIV3Schema.properties.`
    )
  }

  const group = crdMeta[0].group
  const kind = crdMeta[0].kind
  const deprecated = crdMetaVersion[0].deprecated
  const appVersion = ('appVersion' in crdMetaVersion[0] ? crdMetaVersion[0].appVersion : "")
  const validVersions = sortApiVersionsNewestFirst(
    crdMeta[0].versions.map((x) => x.name)
  )

  return { name, versionOnFocus, kind, group, deprecated, appVersion, validVersions, spec, status }
}
