#!/usr/bin/env node
/**
 * Ensures every CRD version listed in src/lib/resources.yaml has a matching
 * file under static/resources/<crdName>/<version>.yaml
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const metaPath = path.join(root, 'src/lib/resources.yaml')
const meta = yaml.load(fs.readFileSync(metaPath, 'utf8'))

const missing = []
for (const list of Object.values(meta)) {
	if (!Array.isArray(list)) continue
	for (const crd of list) {
		for (const v of crd.versions ?? []) {
			const rel = path.join('static/resources', crd.name, `${v.name}.yaml`)
			const abs = path.join(root, rel)
			if (!fs.existsSync(abs)) missing.push(rel)
		}
	}
}

if (missing.length > 0) {
	console.error(
		`check-resource-statics: ${missing.length} missing file(s) for entries in src/lib/resources.yaml:\n` +
			missing.map((p) => `  - ${p}`).join('\n')
	)
	process.exit(1)
}

console.log('check-resource-statics: all resources.yaml entries have static YAML files.')
