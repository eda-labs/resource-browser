export function getScope(resource: any) {
  return resource.type === "array" ? resource.items : resource
}

export function getDescription(resource: any) {
  return resource?.description || (resource.type === "array" ? resource.items.type : "")
}