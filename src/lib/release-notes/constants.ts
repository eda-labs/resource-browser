import type { UpgradeRisk } from './types';

export const RISK_COLOR: Record<UpgradeRisk, string> = {
	high: '#e24b4a',
	medium: '#ef9f27',
	low: '#639922'
};

export const RISK_BG: Record<UpgradeRisk, string> = {
	high: '#fcebeb',
	medium: '#faeeda',
	low: '#eaf3de'
};

export const TABS = [
	'Overview',
	'Breaking',
	'Deprecated',
	'New Resources',
	'Modified',
	'Upgrade Risk'
] as const;

export const TAB_ICONS = ['◈', '⚠', '⊘', '✦', '✎', '↑'] as const;

export const CHANGE_COLORS: Record<string, string> = {
	required_added: '#e24b4a',
	type_change: '#ef9f27',
	removed: '#e24b4a',
	enum_removed: '#e24b4a',
	default_changed: '#ef9f27',
	added: '#639922',
	optional_added: '#639922',
	enum_added: '#639922'
};

export const HIGH_RISK_CHANGE_TYPES = new Set([
	'required_added',
	'removed',
	'enum_removed',
	'type_change'
]);
