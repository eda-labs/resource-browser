type TokenType = 'key' | 'string' | 'number' | 'bool' | 'null' | 'comment' | 'doc' | 'plain';

type Token = { text: string; type: TokenType };

export function highlightYaml(source: string): Token[] {
	const tokens: Token[] = [];
	const lines = source.split('\n');

	for (let li = 0; li < lines.length; li++) {
		if (li > 0) tokens.push({ text: '\n', type: 'plain' });
		const line = lines[li];

		if (/^\s*#/.test(line)) {
			tokens.push({ text: line, type: 'comment' });
			continue;
		}
		if (/^---\s*$/.test(line)) {
			tokens.push({ text: line, type: 'doc' });
			continue;
		}

		const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_.-]+)(\s*:\s*)(.*)$/);
		if (keyMatch) {
			tokens.push({ text: keyMatch[1], type: 'plain' });
			tokens.push({ text: keyMatch[2], type: 'key' });
			tokens.push({ text: keyMatch[3], type: 'plain' });
			tokenizeValue(keyMatch[4], tokens);
			continue;
		}

		const listMatch = line.match(/^(\s*-\s*)(.*)$/);
		if (listMatch) {
			tokens.push({ text: listMatch[1], type: 'plain' });
			tokenizeValue(listMatch[2], tokens);
			continue;
		}

		tokens.push({ text: line, type: 'plain' });
	}

	return tokens;
}

function tokenizeValue(value: string, tokens: Token[]): void {
	const trimmed = value.trim();
	if (!trimmed) {
		tokens.push({ text: value, type: 'plain' });
		return;
	}
	if (/^["']/.test(trimmed)) {
		tokens.push({ text: value, type: 'string' });
		return;
	}
	if (/^(true|false)$/i.test(trimmed)) {
		tokens.push({ text: value, type: 'bool' });
		return;
	}
	if (/^null$/i.test(trimmed)) {
		tokens.push({ text: value, type: 'null' });
		return;
	}
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		tokens.push({ text: value, type: 'number' });
		return;
	}
	tokens.push({ text: value, type: 'string' });
}

export function tokenClass(type: TokenType): string {
	switch (type) {
		case 'key':
			return 'yaml-hl-key';
		case 'string':
			return 'yaml-hl-string';
		case 'number':
			return 'yaml-hl-number';
		case 'bool':
			return 'yaml-hl-bool';
		case 'null':
			return 'yaml-hl-null';
		case 'comment':
			return 'yaml-hl-comment';
		case 'doc':
			return 'yaml-hl-doc';
		default:
			return '';
	}
}
