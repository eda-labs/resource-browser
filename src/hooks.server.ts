import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	
	// Suppress 404 logging for CRD version availability checks
	// These are intentional HEAD requests to check if a version exists
	if (response.status === 404 && 
	    event.url.pathname.includes('/resources/') && 
	    event.url.pathname.endsWith('.yaml')) {
		// Don't log these 404s - they're expected during version availability checks
		return response;
	}
	
	return response;
};

// Suppress console output for CRD check 404s
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleLog = console.log;

console.warn = (...args: any[]) => {
	const msg = args.join(' ');
	if (typeof msg === 'string' && 
	    msg.includes('Not found:') && 
	    msg.includes('/resources/') && 
	    msg.includes('.yaml')) {
		return; // Skip logging
	}
	originalConsoleWarn.apply(console, args);
};

console.info = (...args: any[]) => {
	const msg = args.join(' ');
	if (typeof msg === 'string' && 
	    msg.includes('Not found:') && 
	    msg.includes('/resources/') && 
	    msg.includes('.yaml')) {
		return; // Skip logging
	}
	originalConsoleInfo.apply(console, args);
};

console.log = (...args: any[]) => {
	const msg = args.join(' ');
	if (typeof msg === 'string' && 
	    msg.includes('Not found:') && 
	    msg.includes('/resources/') && 
	    msg.includes('.yaml')) {
		return; // Skip logging
	}
	originalConsoleLog.apply(console, args);
};
