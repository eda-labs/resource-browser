import { describe, expect, it } from 'vitest';
import { escapeHtml, highlightMatches } from './highlight';

describe('escapeHtml', () => {
	it('escapes HTML metacharacters', () => {
		expect(escapeHtml('<script>alert("x")</script>')).toBe(
			'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
		);
	});
});

describe('highlightMatches ReDoS guards', () => {
	it('disables regex mode for long patterns', () => {
		const hay = 'hello world';
		const longPattern = '(a+)+'.repeat(30);
		const result = highlightMatches(hay, longPattern, true);
		expect(result).toBe(escapeHtml(hay));
	});

	it('escapes haystack text in regex mode', () => {
		const result = highlightMatches('<img>', 'img', true);
		expect(result).toContain('&lt;');
		expect(result).not.toContain('<img>');
	});

	it('bounds catastrophic regex with iteration cap', () => {
		const hay = 'a'.repeat(5000);
		const result = highlightMatches(hay, 'a+', true);
		expect(result).toContain('<mark');
		expect(result.length).toBeGreaterThan(0);
	});
});
