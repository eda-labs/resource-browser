import { describe, expect, it } from 'vitest';
import {
	buildShareUrl,
	decodeBundleFromUrl,
	encodeBundleForUrl,
	MAX_BUNDLE_URL_PARAM_BYTES
} from './shareBundle';

describe('shareBundle', () => {
	it('round-trips YAML through gzip and base64url encoding', async () => {
		const yaml = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: example
spec:
  config: test
`;
		const { param, tooLarge } = await encodeBundleForUrl(yaml);
		expect(tooLarge).toBe(false);
		expect(param.length).toBeGreaterThan(0);

		const decoded = await decodeBundleFromUrl(param);
		expect(decoded).toBe(yaml);
	});

	it('builds a share URL with release and bundle params', async () => {
		const { param } = await encodeBundleForUrl('kind: Test\n');
		const url = buildShareUrl('https://example.com', '26.4.2', param);
		expect(url).toMatch(/^https:\/\/example\.com\/validate-yaml\?/);
		expect(url).toContain('release=26.4.2');
		expect(url).toContain('bundle=');
	});

	it('flags payloads that exceed the safe URL size limit', async () => {
		// Highly entropic content so gzip stays large enough to trip the URL limit.
		const largeYaml = Array.from({ length: MAX_BUNDLE_URL_PARAM_BYTES * 2 }, (_, i) =>
			`key-${i}: ${Math.random().toString(36).slice(2)}`
		).join('\n');
		const { tooLarge, encodedLength } = await encodeBundleForUrl(largeYaml);
		expect(tooLarge).toBe(true);
		expect(encodedLength).toBeGreaterThan(MAX_BUNDLE_URL_PARAM_BYTES);
	});
});
