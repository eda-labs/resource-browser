function escapeHtml(s: string): string {
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

export function highlightMatches(text: string, query: string, regexMode: boolean): string {
	const q = String(query ?? '').trim();
	if (!q) return escapeHtml(text);
	const hay = String(text || '');

	if (regexMode) {
		try {
			const rawRe = new RegExp(q, 'ig');
			let lastIndex = 0;
			const parts: string[] = [];
			let match: RegExpExecArray | null;
			while ((match = rawRe.exec(hay)) !== null) {
				const start = match.index;
				const end = rawRe.lastIndex;
				parts.push(escapeHtml(hay.substring(lastIndex, start)));
				parts.push(
					`<mark class="comparison-highlight">` +
						`${escapeHtml(hay.substring(start, end))}</mark>`
				);
				lastIndex = end;
				if (rawRe.lastIndex === match.index) rawRe.lastIndex++;
			}
			parts.push(escapeHtml(hay.substring(lastIndex)));
			return parts.join('');
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
			const rawRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, 'ig');
			let lastIndex = 0;
			const parts: string[] = [];
			let match: RegExpExecArray | null;
			while ((match = rawRe.exec(hay)) !== null) {
				const start = match.index;
				const end = rawRe.lastIndex;
				parts.push(escapeHtml(hay.substring(lastIndex, start)));
				parts.push(
					`<mark class="comparison-highlight">` +
						`${escapeHtml(hay.substring(start, end))}</mark>`
				);
				lastIndex = end;
				if (rawRe.lastIndex === match.index) rawRe.lastIndex++;
			}
			parts.push(escapeHtml(hay.substring(lastIndex)));
			return parts.join('');
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
