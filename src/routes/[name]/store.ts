import { writable } from 'svelte/store'

export const expandAll = writable(false)
export const expandAllScope = writable("local") // supported value (local/global)
export const ulExpanded = writable<string[]>([])
