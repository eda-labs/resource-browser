import { error } from '@sveltejs/kit'

import type { CrdVersionsMap } from '$lib/structure'

import yaml from 'js-yaml'
import res from '$lib/resources.yaml?raw'

const crdResources = yaml.load(res)
const resources = crdResources as CrdVersionsMap

export async function load({ params }) {
  const name = params.name
  const rest = name.substring(name.indexOf(".") + 1)

  const crdMeta = resources[rest].filter(x => x.name === name)
  if(crdMeta.length !== 1) {
    throw error(404, "Invalid resource name")
  }

  throw error(404, `${params.name} - version parameter missing`)
}