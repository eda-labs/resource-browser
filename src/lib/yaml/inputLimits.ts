/** Maximum YAML editor / validation input size (512 KiB). */
export const MAX_YAML_INPUT_BYTES = 512 * 1024;

export type ClampYamlInputResult = {
	text: string;
	truncated: boolean;
};

/** Truncate UTF-8 input to MAX_YAML_INPUT_BYTES when exceeded. */
export function clampYamlInput(text: string): ClampYamlInputResult {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= MAX_YAML_INPUT_BYTES) {
		return { text, truncated: false };
	}
	return {
		text: new TextDecoder().decode(bytes.slice(0, MAX_YAML_INPUT_BYTES)),
		truncated: true
	};
}
