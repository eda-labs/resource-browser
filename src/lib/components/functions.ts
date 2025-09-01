import type { Schema } from "$lib/structure"

export function getScope(resource: Schema) {
  return resource.type === "array" ? resource.items : resource
}

export function getDescription(resource: Schema) {
  return resource?.description || (resource.type === "array" ? resource.items.type : "")
}

// Get the default value of a resource field.
export function getDefault(resource: Schema) {
  // prefer explicit default on the resource, otherwise for arrays check items
  const d = (resource && 'default' in resource && resource.default !== undefined)
    ? resource.default
    : (resource.type === 'array' && resource.items && 'default' in resource.items ? resource.items.default : undefined)

  if (d === undefined) return ''
  try {
    return typeof d === 'object' ? JSON.stringify(d) : String(d)
  } catch (e) {
    return String(d)
  }
}

export function hashExistDeep(hash: string, currentId: string) {
  if (hash.indexOf(currentId) !== -1) {
    return true
  }
  return false
}