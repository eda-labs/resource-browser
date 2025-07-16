import { error } from '@sveltejs/kit';

export async function load({ fetch, params }) {
  const name = params.name

  try {
    const resp = await fetch(`/resources/${name}/resource.json`)
    const crd = await resp.json()

    const group = crd.spec.group
    const kind = crd.spec.names.kind
    const versions = {}

    crd.spec.versions.forEach(x => {
      versions[x.name] = {}
      versions[x.name]["spec"] = x.schema.openAPIV3Schema.properties.spec
      versions[x.name]["status"] = x.schema.openAPIV3Schema.properties.status

      /// testing more than one version
      /// versions["testVersion"] = {}
      /// versions["testVersion"]["spec"] = x.schema.openAPIV3Schema.properties.status
      /// versions["testVersion"]["status"] = x.schema.openAPIV3Schema.properties.spec
    })

    return { group, kind, versions }
  } catch(e) {
    throw error(404, "Error fetching resource" + e)
  }
}