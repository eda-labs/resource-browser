import { describe, expect, it } from 'vitest';
import { scanInvalidBooleanLiterals } from './scanSource';

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
