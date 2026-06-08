/** Max regex pattern length — longer patterns fall back to plain search to reduce ReDoS risk. */
const MAX_REGEX_QUERY_LENGTH = 200;
/** Max haystack scanned with RegExp.exec to bound catastrophic backtracking cost. */
const MAX_REGEX_HAYSTACK_LENGTH = 100_000;
/** Max RegExp.exec iterations per highlight pass. */
const MAX_REGEX_EXEC_ITERATIONS = 1000;

export function escapeHtml(s: string): string {
	const entityMap: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	};
	return String(s ?? '').replace(/[&<>"']/g, (c) => entityMap[c] ?? c);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightWithRegex(rawRe: RegExp, hay: string): string {
	const scanHay =
		hay.length > MAX_REGEX_HAYSTACK_LENGTH ? hay.substring(0, MAX_REGEX_HAYSTACK_LENGTH) : hay;
	let lastIndex = 0;
	const parts: string[] = [];
	let match: RegExpExecArray | null;
	let iterations = 0;

	while ((match = rawRe.exec(scanHay)) !== null) {
		if (++iterations > MAX_REGEX_EXEC_ITERATIONS) break;
		const start = match.index;
		const end = rawRe.lastIndex;
		parts.push(escapeHtml(hay.substring(lastIndex, start)));
		parts.push(
			`<mark class="comparison-highlight">` + `${escapeHtml(hay.substring(start, end))}</mark>`
		);
		lastIndex = end;
		if (rawRe.lastIndex === match.index) rawRe.lastIndex++;
	}

	parts.push(escapeHtml(hay.substring(lastIndex)));
	return parts.join('');
}

export function highlightMatches(text: string, query: string, regexMode: boolean): string {
	const q = String(query ?? '').trim();
	if (!q) return escapeHtml(text);
	const hay = String(text || '');

	const useRegexMode = regexMode && q.length <= MAX_REGEX_QUERY_LENGTH;

	if (useRegexMode) {
		try {
			return highlightWithRegex(new RegExp(q, 'ig'), hay);
		} catch {
			const lowerQ = q.toLowerCase();
			const idx = hay.toLowerCase().indexOf(lowerQ);
			if (idx === -1) return escapeHtml(hay);
			return (
				`${escapeHtml(hay.substring(0, idx))}` +
				`<mark class="comparison-highlight">${escapeHtml(hay.substring(idx, idx + q.length))}</mark>` +
				`${escapeHtml(hay.substring(idx + q.length))}`
			);
		}
	}

	const lowerQ = q.toLowerCase();
	const alphaOnly = /^[A-Za-z0-9_]+$/.test(q);
	if (alphaOnly) {
		try {
			return highlightWithRegex(new RegExp(`\\b${escapeRegExp(q)}\\b`, 'ig'), hay);
		} catch {
			/* fallback below */
		}
	}

	let result = '';
	let i = 0;
	const lower = hay.toLowerCase();
	while (true) {
		const idx = lower.indexOf(lowerQ, i);
		if (idx === -1) {
			result += escapeHtml(hay.substring(i));
			break;
		}
		result += escapeHtml(hay.substring(i, idx));
		result +=
			`<mark class="comparison-highlight">` +
			`${escapeHtml(hay.substring(idx, idx + q.length))}</mark>`;
		i = idx + q.length;
	}
	return result;
}
