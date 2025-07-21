import { error } from '@sveltejs/kit'

import type { CrdVersionsMap, OpenAPISchema, VersionSchema } from '$lib/structure'
import crdResources from '$lib/resources.json'

const resources = crdResources as CrdVersionsMap

export async function load({ fetch, params }) {
  const [name, versionOnFocus] = params.name.split("_")

  if (name.startsWith("uploaded-")) {
    return { name, versionOnFocus, uploaded: true }
  } else {
    if (!Object.keys(resources).includes(name)) {
      throw error(404, "Invalid resource name")
    }

    if (!resources[name].includes(versionOnFocus)) {
      throw error(404, "Invalid version for the resource name")
    }

    try {
      const resp = await fetch(`/resources/${name}/resource.json`)
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
    } catch (e) {
      throw error(404, "Error fetching resource" + e)
    }
  }
}