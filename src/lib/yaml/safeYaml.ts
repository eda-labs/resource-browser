import yaml from 'js-yaml';

/** JSON-only schema for untrusted / user-pasted YAML (blocks custom tags and anchors). */
export const USER_YAML_OPTIONS: yaml.LoadOptions = { schema: yaml.JSON_SCHEMA };

/** Restricted schema for bundled or server-fetched CRD / manifest files. */
export const STATIC_YAML_OPTIONS: yaml.LoadOptions = { schema: yaml.CORE_SCHEMA };

export function loadUserYaml(text: string): unknown {
	return yaml.load(text, USER_YAML_OPTIONS);
}

export function loadStaticYaml(text: string): unknown {
	return yaml.load(text, STATIC_YAML_OPTIONS);
}

export function loadAllUserYaml(text: string): unknown[] {
	const docs: unknown[] = [];
	yaml.loadAll(text, (doc) => {
		if (doc !== null && doc !== undefined) docs.push(doc);
	}, USER_YAML_OPTIONS);
	return docs;
}
