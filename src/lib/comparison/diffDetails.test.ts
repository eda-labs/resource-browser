import { describe, expect, it } from 'vitest';
import { parseDiffLine } from './diffDetails';

describe('parseDiffLine', () => {
	it('extracts before and after from enriched modify lines', () => {
		const parsed = parseDiffLine('~ Modified: spec.mode :: "a" → "b"');
		expect(parsed.type).toBe('modify');
		expect(parsed.path).toBe('spec.mode');
		expect(parsed.before).toBe('"a"');
		expect(parsed.after).toBe('"b"');
		expect(parsed.section).toBe('spec');
	});

	it('parses legacy modify lines without values', () => {
		const parsed = parseDiffLine('~ Modified: status.phase');
		expect(parsed.path).toBe('status.phase');
		expect(parsed.before).toBeUndefined();
	});
});
