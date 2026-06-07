import { describe, expect, it } from 'vitest';
import { fixInvalidBooleanLiterals, scanInvalidBooleanLiterals } from './scanSource';

describe('scanInvalidBooleanLiterals', () => {
	it('flags uppercase boolean literals as errors', () => {
		const yaml = `apiVersion: v1
kind: Config
metadata:
  name: test
spec:
  enabled: False
`;
		const issues = scanInvalidBooleanLiterals(yaml);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain('lowercase true or false');
		expect(issues[0].message).toContain("'False'");
		expect(issues[0].line).toBe(6);
	});

	it('allows lowercase booleans and quoted strings', () => {
		const yaml = `spec:
  enabled: true
  disabled: false
  note: "False alarm"
  label: 'True story'
`;
		expect(scanInvalidBooleanLiterals(yaml)).toHaveLength(0);
	});

	it('flags list boolean literals', () => {
		const yaml = `spec:
  flags:
    - True
`;
		const issues = scanInvalidBooleanLiterals(yaml);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain("'True'");
	});
});

describe('fixInvalidBooleanLiterals', () => {
	it('replaces wrongly-cased boolean literals with lowercase', () => {
		const yaml = `spec:
  enabled: False
  flags:
    - TRUE
`;
		const { yaml: fixed, fixes } = fixInvalidBooleanLiterals(yaml);
		expect(fixed).toMatch(/enabled: false/);
		expect(fixed).toMatch(/- true/);
		expect(fixes).toHaveLength(2);
		expect(fixes[0].from).toBe('False');
		expect(fixes[1].from).toBe('TRUE');
	});

	it('does not change quoted strings', () => {
		const yaml = `spec:
  note: "False alarm"
`;
		const { yaml: fixed, fixes } = fixInvalidBooleanLiterals(yaml);
		expect(fixed).toBe(yaml);
		expect(fixes).toHaveLength(0);
	});
});
