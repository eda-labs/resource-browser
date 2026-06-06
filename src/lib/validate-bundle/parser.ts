import { parseDocuments } from '$lib/yaml-validation/parseDocuments';
import type { BundleResource } from './types';

function resourceId(name: string, namespace: string, kind: string): string {
	return `${namespace}/${kind}/${name}`;
}

export function parseBundleResources(yamlInput: string): {
	ok: true;
	resources: BundleResource[];
} | {
	ok: false;
	message: string;
	line?: number;
	column?: number;
} {
	const parsed = parseDocuments(yamlInput);
	if (!parsed.ok) {
		return { ok: false, message: parsed.message, line: parsed.line, column: parsed.column };
	}

	const resources: BundleResource[] = [];

	for (const doc of parsed.docs) {
		const apiVersion = String(doc.data.apiVersion || '');
		const kind = String(doc.data.kind || '');
		const parts = apiVersion.split('/');
		const group = parts.length === 2 ? parts[0] : '';
		const version = parts.length === 2 ? parts[1] : '';
		const metadata = (doc.data.metadata || {}) as Record<string, unknown>;
		const name = String(metadata.name || `doc-${doc.index + 1}`);
		const namespace = String(metadata.namespace || 'default');

		resources.push({
			id: resourceId(name, namespace, kind || `Unknown-${doc.index + 1}`),
			docIndex: doc.index,
			kind,
			apiVersion,
			group,
			version,
			name,
			namespace,
			data: doc.data,
			doc
		});
	}

	return { ok: true, resources };
}

export { resourceId };
