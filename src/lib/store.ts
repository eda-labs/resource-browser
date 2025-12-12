import { writable } from 'svelte/store';

export const expandAll = writable(false);
export const expandAllScope = writable('local'); // supported value (local/global)
export const ulExpanded = writable<string[]>([]);

// Sidebar open state for desktop (persist across sessions)
function createSidebarStore() {
	const key = 'sidebarOpen';
	const initial =
		typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null
			? localStorage.getItem(key) === 'true'
			: true;

	const { subscribe, set, update } = writable<boolean>(initial);

	subscribe((v) => {
		try {
			if (typeof localStorage !== 'undefined') localStorage.setItem(key, v ? 'true' : 'false');
		} catch (e) {
			// ignore
		}
	});

	return {
		subscribe,
		open: () => set(true),
		close: () => set(false),
		toggle: () => update((v) => !v),
		set
	};
}

export const sidebarOpen = createSidebarStore();
