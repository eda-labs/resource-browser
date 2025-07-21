import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Let SvelteKit handle all routes normally
	return await resolve(event);
};
