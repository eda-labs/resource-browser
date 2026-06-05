import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark';

function readStoredTheme(): ThemeMode | null {
	if (!browser) return null;
	try {
		const stored = localStorage.getItem('theme');
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		/* ignore */
	}
	return null;
}

function readSystemTheme(): ThemeMode {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(): ThemeMode {
	return readStoredTheme() ?? readSystemTheme();
}

export function applyTheme(mode: ThemeMode): void {
	if (!browser) return;
	document.documentElement.classList.toggle('dark', mode === 'dark');
	try {
		localStorage.setItem('theme', mode);
	} catch {
		/* ignore */
	}
}

function readDomTheme(): ThemeMode {
	if (!browser) return resolveTheme();
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Shared theme state — keeps every Theme toggle in sync. */
export const theme = writable<ThemeMode>('light');

let initialized = false;

/** Call once on the client to sync the store with inline script / localStorage. */
export function initTheme(): () => void {
	if (!browser || initialized) return () => {};
	initialized = true;

	const current = readDomTheme();
	theme.set(current);

	const observer = new MutationObserver(() => {
		const domMode = readDomTheme();
		theme.update((current) => (current === domMode ? current : domMode));
	});
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

	return () => {
		observer.disconnect();
		initialized = false;
	};
}

export function toggleTheme(): void {
	theme.update((current) => {
		const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		return next;
	});
}
