import { MAX_YAML_INPUT_BYTES } from '$lib/yaml/inputLimits';

/** Safe upper bound for query-string payloads (bytes of base64url param). */
export const MAX_BUNDLE_URL_PARAM_BYTES = 8192;

/** Reject decompressed bundles larger than the editor input cap. */
export const MAX_BUNDLE_DECOMPRESSED_BYTES = MAX_YAML_INPUT_BYTES;

const BUNDLE_PARAM = 'bundle';

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(encoded: string): Uint8Array {
	const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const padLen = (4 - (padded.length % 4)) % 4;
	const base64 = padded + '='.repeat(padLen);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream !== 'undefined') {
		const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	const { gzipSync } = await import('node:zlib');
	return new Uint8Array(gzipSync(input));
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'undefined') {
		const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	const { gunzipSync } = await import('node:zlib');
	return new Uint8Array(gunzipSync(input));
}

export type EncodeBundleResult = {
	param: string;
	encodedLength: number;
	tooLarge: boolean;
};

/** Gzip-compress YAML and base64url-encode for URL sharing. */
export async function encodeBundleForUrl(yaml: string): Promise<EncodeBundleResult> {
	const bytes = new TextEncoder().encode(yaml);
	const compressed = await gzipBytes(bytes);
	const param = base64UrlEncode(compressed);
	return {
		param,
		encodedLength: param.length,
		tooLarge: param.length > MAX_BUNDLE_URL_PARAM_BYTES
	};
}

/** Decode a base64url gzip bundle param back to YAML. Returns null on failure. */
export async function decodeBundleFromUrl(param: string): Promise<string | null> {
	try {
		const trimmed = param.trim();
		if (!trimmed || trimmed.length > MAX_BUNDLE_URL_PARAM_BYTES) return null;

		const compressed = base64UrlDecode(trimmed);
		if (compressed.length > MAX_BUNDLE_URL_PARAM_BYTES * 2) return null;

		const decompressed = await gunzipBytes(compressed);
		if (decompressed.length > MAX_BUNDLE_DECOMPRESSED_BYTES) return null;

		return new TextDecoder().decode(decompressed);
	} catch {
		return null;
	}
}

export function buildShareUrl(origin: string, release: string, bundleParam: string): string {
	const params = new URLSearchParams();
	if (release) params.set('release', release);
	params.set(BUNDLE_PARAM, bundleParam);
	return `${origin}/validate-yaml?${params.toString()}`;
}

export function getBundleParamFromSearchParams(params: URLSearchParams): string | null {
	return params.get(BUNDLE_PARAM) || params.get('yaml');
}
