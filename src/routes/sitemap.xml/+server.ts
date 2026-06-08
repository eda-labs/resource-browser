import { loadStaticYaml } from '$lib/yaml/safeYaml';
import resourcesYaml from '$lib/resources.yaml?raw';
import type { RequestHandler } from './$types';

const staticPaths = ['/', '/sitemap', '/spec-search', '/spec-search-auto', '/comparison', '/validate-yaml', '/dependency-map'];

function escapeXml(value: string) {
	return value.replace(/[<>&"']/g, (char) => {
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
}

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin.replace(/\/$/, '');
	const now = new Date().toISOString().split('T')[0];
	const resources = loadStaticYaml(resourcesYaml) as Record<
		string,
		Array<{ name: string; versions: Array<{ name: string }> }>
	>;

	const urls = [
		...staticPaths.map((path) => ({
			loc: `${origin}${path}`,
			priority: path === '/' ? '1.0' : path === '/sitemap' ? '0.8' : '0.7',
			changefreq: 'monthly',
			lastmod: now
		})),
		...Object.values(resources).flatMap((group) =>
			group.flatMap((resource) =>
				resource.versions.map((version) => ({
					loc: `${origin}/${resource.name}/${version.name}`,
					priority: '0.6',
					changefreq: 'monthly',
					lastmod: now
				}))
			)
		)
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		urls
			.map(
				(url) =>
					`  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>\n    <changefreq>${escapeXml(url.changefreq)}</changefreq>\n    <priority>${escapeXml(url.priority)}</priority>\n  </url>`
			)
			.join('\n') +
		`\n</urlset>`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=UTF-8'
		}
	});
};
