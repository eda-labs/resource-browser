import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

// Plugin to suppress 404 logs for CRD version availability checks
const suppressCrdCheckLogs = (): Plugin => ({
	name: 'suppress-crd-check-logs',
	configureServer(server) {
		// @ts-ignore - Intercept console output to suppress CRD check 404s
		const proc = globalThis.process;
		if (!proc) return;

		const originalStdoutWrite = proc.stdout.write.bind(proc.stdout);
		const originalStderrWrite = proc.stderr.write.bind(proc.stderr);

		// @ts-ignore - Override stdout
		proc.stdout.write = (chunk: any, ...args: any[]) => {
			const str = chunk?.toString() || '';
			if (str.includes('Not found:') && str.includes('/resources/') && str.includes('.yaml')) {
				return true; // Suppress this output
			}
			return originalStdoutWrite(chunk, ...args);
		};

		// @ts-ignore - Override stderr
		proc.stderr.write = (chunk: any, ...args: any[]) => {
			const str = chunk?.toString() || '';
			if (str.includes('Not found:') && str.includes('/resources/') && str.includes('.yaml')) {
				return true; // Suppress this output
			}
			return originalStderrWrite(chunk, ...args);
		};
	}
});

export default defineConfig({
	plugins: [suppressCrdCheckLogs(), tailwindcss(), sveltekit(), devtoolsJson()],
	test: {
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
