import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Suppress noisy 404 handling for intentional CRD version availability HEAD checks.
	// The handle hook returns the response without additional server-side logging.
	if (
		response.status === 404 &&
		event.url.pathname.includes('/resources/') &&
		event.url.pathname.endsWith('.yaml')
	) {
		return response;
	}

	return response;
};
