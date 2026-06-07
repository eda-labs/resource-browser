export type ReleaseTone = 'low' | 'medium' | 'high';

export const RISK_COLOR: Record<ReleaseTone, string> = {
	high: '#e24b4a',
	medium: '#ef9f27',
	low: '#639922'
};

export const TABS = ['Overview', 'Deprecated', 'New Resources', 'Modified'] as const;

export const TAB_ICONS = ['◈', '⊘', '✦', '✎'] as const;

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
