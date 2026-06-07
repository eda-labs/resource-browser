import type { ReleaseNotes } from './types';

/** Fallback structured notes when schema comparison data is unavailable. */
export function generateMockNotes(fromVer: string, toVer: string): ReleaseNotes {
	return {
		newResources: [],
		removedResources: [],
		modifiedResources: [],
		deprecated: []
	};
}
