import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

const siteUrl = process.env.SITE_URL || 'https://resource-browser-92y.pages.dev';
const outputPath = process.env.SITEMAP_OUTPUT || 'static/sitemap.xml';
const releasesPath = 'src/lib/releases.yaml';
const staticRoutes = [
	'/',
	'/sitemap',
	'/spec-search',
	'/spec-search-auto',
	'/comparison',
	'/validate-yaml'
];

const priorityForPath = (path) => {
	if (path === '/') return '1.0';
	if (path === '/sitemap') return '0.8';
	return '0.7';
};

const escapeXml = (value) =>
	value.replace(/[<>&"']/g, (char) => {
		switch (char) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			case '"':
				return '&quot;';
			case "'":
				return '&apos;';
			default:
				return char;
		}
	});

const formatUrl = ({ loc, lastmod, changefreq, priority }) => {
	return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
};

const main = async () => {
	const rawReleases = await fs.readFile(releasesPath, 'utf8');
	const releaseConfig = yaml.load(rawReleases, { schema: yaml.CORE_SCHEMA });
	const now = new Date().toISOString().split('T')[0];

	if (!releaseConfig || typeof releaseConfig !== 'object' || !Array.isArray(releaseConfig.releases)) {
		throw new Error('releases.yaml did not parse as expected');
	}

	const urls = [];

	for (const route of staticRoutes) {
		urls.push({
			loc: `${siteUrl}${route}`,
			lastmod: now,
			changefreq: 'monthly',
			priority: priorityForPath(route)
		});
	}

	for (const release of releaseConfig.releases) {
		if (!release?.name || !release?.folder) continue;

		const manifestPath = path.join('static', release.folder, 'manifest.json');
		let manifestRaw;
		try {
			manifestRaw = await fs.readFile(manifestPath, 'utf8');
		} catch (error) {
			console.warn(`Skipping release ${release.name}: could not read ${manifestPath}`);
			continue;
		}

		let manifest;
		try {
			manifest = JSON.parse(manifestRaw);
		} catch (error) {
			console.warn(`Skipping release ${release.name}: invalid JSON in ${manifestPath}`);
			continue;
		}

		const releaseParam = release.default ? '' : `?release=${encodeURIComponent(release.name)}`;

		if (!Array.isArray(manifest)) continue;

		for (const entry of manifest) {
			if (!entry?.name || !Array.isArray(entry.versions)) continue;
			for (const version of entry.versions) {
				if (!version?.name) continue;
				urls.push({
					loc: `${siteUrl}/${entry.name}/${version.name}${releaseParam}`,
					lastmod: now,
					changefreq: 'monthly',
					priority: '0.6'
				});
			}
		}
	}

	urls.sort((a, b) => a.loc.localeCompare(b.loc));

	const xml = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...urls.map(formatUrl), `</urlset>`].join('\n');

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, xml + '\n', 'utf8');
	console.log(`Wrote ${urls.length} urls to ${outputPath}`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
