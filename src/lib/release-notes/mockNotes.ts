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
		summary: `Release ${toVer} delivers schema updates relative to ${fromVer}. ${
			crossMajor
				? 'This major version upgrade may introduce breaking changes — validate manifests before applying.'
				: 'Review the comparison report for field-level changes before upgrading production clusters.'
		}`,
		newResources: [],
		removedResources: [],
		modifiedResources: [],
		deprecated: [],
		breakingChanges: [],
		operationalImpact: crossMajor
			? `Before upgrading to ${toVer}, run the EDA bundle validator against your full manifest set. Cross-major upgrades require a maintenance window and lab validation first.`
			: `Release ${toVer} is likely a drop-in upgrade from ${fromVer}. Confirm with the schema comparison tool if comparison data was unavailable for this pair.`,
		upgradeRisk: risk,
		upgradeRiskJustification: crossMajor
			? `Cross-major upgrade from ${fromVer} to ${toVer}. Manifest compatibility cannot be confirmed without comparison data.`
			: `Incremental upgrade from ${fromVer} to ${toVer}. Comparison data was unavailable — treat as ${risk} risk until validated.`,
		upgradeChecklist: [
			`Run bundle validator against all manifests for ${toVer} schema`,
			`Compare ${fromVer} → ${toVer} in the Comparison tool`,
			'Stage upgrade in lab environment first',
			'Schedule maintenance window for production apply'
		],
		estimatedEffort: crossMajor ? 'High: >4h' : risk === 'medium' ? 'Medium: 1-4h' : 'Low: <1h'
	};
}
