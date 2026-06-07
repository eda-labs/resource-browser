import { describe, expect, it } from 'vitest';
import { parseBundleResources } from './parser';
import { validateEdaRules } from './edaRules';

const CONFIGLET = `apiVersion: config.eda.nokia.com/v1
kind: Configlet
metadata:
  name: vrf-customer-a
  namespace: eda
spec:
  config: test
`;

describe('validateEdaRules', () => {
	it('returns no issues for valid manifests (EDA-specific rules only)', () => {
		const parsed = parseBundleResources(CONFIGLET);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(validateEdaRules(parsed.resources)).toHaveLength(0);
	});
});
