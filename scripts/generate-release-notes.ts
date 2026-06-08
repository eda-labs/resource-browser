/**
 * Pre-compute release notes JSON for each consecutive release pair.
 *
 * Re-run when releases.yaml changes or a new release folder is added:
 *   npm run generate:release-notes
 *
 * Output: static/release-notes/{version}.json + static/release-notes/index.json
 */
import fs from 'fs/promises';
import path from 'path';
import { access } from 'fs/promises';
import yaml from 'js-yaml';
import {
	buildConsecutivePairs,
	generateReleaseNotesForPair,
	sortReleasesByVersion
} from '../src/lib/release-notes/generateNotes';
import type { ReleaseNotesEntry } from '../src/lib/release-notes/types';
import type { ReleasesConfig } from '../src/lib/structure';

const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, 'static');
const OUTPUT_DIR = path.join(STATIC_ROOT, 'release-notes');
const RELEASES_PATH = path.join(ROOT, 'src/lib/releases.yaml');

function setupStaticFetch(): void {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const urlStr =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.pathname
					: input.url.startsWith('http')
						? new URL(input.url).pathname
						: input.url;

		if (!urlStr.startsWith('/')) {
			throw new Error(`generate-release-notes: unsupported fetch URL ${urlStr}`);
		}

		const filePath = path.join(STATIC_ROOT, urlStr.slice(1));

		if (init?.method === 'HEAD') {
			try {
				await access(filePath);
				return new Response(null, { status: 200 });
			} catch {
				return new Response(null, { status: 404 });
			}
		}

		try {
			const body = await fs.readFile(filePath, 'utf8');
			const headers: Record<string, string> = {};
			if (urlStr.endsWith('.json')) headers['content-type'] = 'application/json';
			else if (urlStr.endsWith('.yaml') || urlStr.endsWith('.yml')) {
				headers['content-type'] = 'text/yaml';
			}
			return new Response(body, { status: 200, headers });
		} catch {
			return new Response(null, { status: 404 });
		}
	}) as typeof fetch;
}

type IndexEntry = {
	toVer: string;
	fromVer: string;
	source: ReleaseNotesEntry['source'];
	timestamp: number;
};

async function loadExistingEntry(toVer: string): Promise<ReleaseNotesEntry | null> {
	try {
		const raw = await fs.readFile(path.join(OUTPUT_DIR, `${toVer}.json`), 'utf8');
		return JSON.parse(raw) as ReleaseNotesEntry;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	setupStaticFetch();

	const force = process.argv.includes('--force');

	const raw = await fs.readFile(RELEASES_PATH, 'utf8');
	const config = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as ReleasesConfig;
	if (!config?.releases?.length) {
		throw new Error('releases.yaml did not parse as expected');
	}

	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	const pairs = buildConsecutivePairs(config.releases);
	const sorted = sortReleasesByVersion(config.releases);
	const latest = sorted[0]?.name ?? '';
	const manifestCache = new Map();
	const yamlCache = new Map<string, string>();
	const indexEntries: IndexEntry[] = [];

	for (const { from, to } of pairs) {
		const existing = await loadExistingEntry(to.name);
		if (
			!force &&
			existing &&
			existing.fromVer === from.name &&
			existing.toVer === to.name
		) {
			console.log(`Skipping ${to.name} (precomputed, pair unchanged)`);
			indexEntries.push({
				toVer: existing.toVer,
				fromVer: existing.fromVer,
				source: existing.source,
				timestamp: existing.timestamp
			});
			continue;
		}

		console.log(`Generating release notes: ${from.name} → ${to.name}...`);
		const entry = await generateReleaseNotesForPair({
			sourceRelease: from,
			targetRelease: to,
			manifestCache,
			yamlCache
		});

		const outPath = path.join(OUTPUT_DIR, `${to.name}.json`);
		await fs.writeFile(outPath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
		console.log(`  Wrote ${outPath} (source: ${entry.source})`);

		indexEntries.push({
			toVer: entry.toVer,
			fromVer: entry.fromVer,
			source: entry.source,
			timestamp: entry.timestamp
		});
	}

	indexEntries.sort((a, b) => b.toVer.localeCompare(a.toVer, undefined, { numeric: true }));

	const index = {
		generatedAt: new Date().toISOString(),
		latest,
		entries: indexEntries
	};

	await fs.writeFile(
		path.join(OUTPUT_DIR, 'index.json'),
		JSON.stringify(index, null, 2) + '\n',
		'utf8'
	);

	console.log(`Done — ${indexEntries.length} release note(s) in ${OUTPUT_DIR}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
