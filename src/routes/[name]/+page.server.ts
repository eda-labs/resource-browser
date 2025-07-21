import { error } from '@sveltejs/kit'

import type { CrdVersionsMap, OpenAPISchema, VersionSchema } from '$lib/structure'
import crdResources from '$lib/resources.json'

const resources = crdResources as CrdVersionsMap

export async function load({ params, url, fetch }: any) {
  const [name, versionOnFocus] = params.name.split("_")

  if(name.startsWith("uploaded-")) {
    return { name, versionOnFocus, uploaded: true }
  } else {
    if(!Object.keys(resources).includes(name)) {
      throw error(404, "Invalid resource name")
    }

    if(!resources[name].includes(versionOnFocus)) {
      throw error(404, "Invalid version for the resource name")
    }

    try {
      // Use absolute URL for server-side fetch
      const resourceUrl = `/resources/${name}/resource.json`
      const resp = await fetch(resourceUrl)
      
      if (!resp.ok) {
        throw error(404, `Resource file not found: ${resourceUrl}`)
      }
      
      const crd = await resp.json()

      const group = crd.spec.group
      const kind = crd.spec.names.kind
      const versions: VersionSchema = {}

      crd.spec.versions.forEach((x: OpenAPISchema) => {
        versions[x.name] = {
          spec: x.schema.openAPIV3Schema.properties.spec,
          status: x.schema.openAPIV3Schema.properties.status
        }
      })

      return { name, group, kind, versions, versionOnFocus, uploaded: false }
    } catch(e) {
      throw error(404, "Error fetching resource: " + String(e))
    }
  }
}
