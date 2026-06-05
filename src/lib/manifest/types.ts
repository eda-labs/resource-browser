/** Lightweight manifest entry used for search, validation, and listing. */
export type ManifestResource = {
	name: string;
	kind?: string;
	group?: string;
	versions?: { name: string; deprecated?: boolean; appVersion?: string }[];
};
