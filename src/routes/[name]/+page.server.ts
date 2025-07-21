import { error } from '@sveltejs/kit'

import type { CrdVersionsMap, OpenAPISchema, VersionSchema } from '$lib/structure'
import crdResources from '$lib/resources.json'

const resources = crdResources as CrdVersionsMap

export async function load({ params, platform, url }: any) {
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
      let crd;
      
      // For Cloudflare Workers, use the ASSETS binding
      if (platform?.env?.ASSETS) {
        const assetUrl = `${url.origin}/resources/${name}/resource.json`;
        const response = await platform.env.ASSETS.fetch(assetUrl);
        if (response.ok) {
          crd = await response.json();
        } else {
          throw error(404, `Asset not found: ${assetUrl} (status: ${response.status})`);
        }
      } else {
        // For development/preview, try direct import
        try {
          const resourceModule = await import(`../../../static/resources/${name}/resource.json`);
          crd = resourceModule.default;
        } catch (importError) {
          throw error(404, `Resource file not found for ${name}`);
        }
      }

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
