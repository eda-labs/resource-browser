import type { ReleaseNotes, UpgradeRisk } from './types';

function computeRisk(fromVer: string, toVer: string): UpgradeRisk {
	const fromMajor = parseInt(fromVer.split('.')[0], 10);
	const toMajor = parseInt(toVer.split('.')[0], 10);
	if (fromMajor !== toMajor) return 'high';
	if (fromVer.split('.')[1] !== toVer.split('.')[1]) return 'medium';
	return 'low';
}

/** Fallback structured notes when schema comparison data is unavailable. */
export function generateMockNotes(fromVer: string, toVer: string): ReleaseNotes {
	const fromMajor = parseInt(fromVer.split('.')[0], 10);
	const toMajor = parseInt(toVer.split('.')[0], 10);
	const crossMajor = fromMajor !== toMajor;
	const risk = computeRisk(fromVer, toVer);

	return {
		newResources: [],
		removedResources: [],
		modifiedResources: [],
		deprecated: [],
		breakingChanges: [],
		totalBreakingCount: 0,
		upgradeRisk: risk,
		upgradeRiskJustification: crossMajor
			? `Cross-major upgrade from ${fromVer} to ${toVer}. Manifest compatibility cannot be confirmed without comparison data.`
			: `Incremental upgrade from ${fromVer} to ${toVer}. Comparison data was unavailable — treat as ${risk} risk until validated.`,
		estimatedEffort: crossMajor ? 'High: >4h' : risk === 'medium' ? 'Medium: 1-4h' : 'Low: <1h'
	};
}
