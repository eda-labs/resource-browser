import type { ThemeMode } from '$lib/theme';
import type { LinkRelation, NodeType } from './types';

export type GraphPalette = {
	background: string;
	gridDot: string;
	panel: string;
	panelBorder: string;
	text: string;
	textMuted: string;
	link: string;
	linkHighlight: string;
	linkDim: string;
	nodeStroke: string;
	nodeLabel: string;
	nodeLabelBg: string;
	tooltipBg: string;
	tooltipBorder: string;
	chipActive: string;
	chipInactive: string;
	focusRing: string;
	config: string;
	configLight: string;
	state: string;
	stateLight: string;
	other: string;
	rel: Record<LinkRelation, string>;
};

const light: GraphPalette = {
	background: '#f1f5f9',
	gridDot: '#94a3b8',
	panel: '#ffffff',
	panelBorder: '#e2e8f0',
	text: '#0f172a',
	textMuted: '#64748b',
	link: '#64748b',
	linkHighlight: '#2563eb',
	linkDim: '#cbd5e1',
	nodeStroke: '#334155',
	nodeLabel: '#0f172a',
	nodeLabelBg: 'rgba(255, 255, 255, 0.96)',
	tooltipBg: '#ffffff',
	tooltipBorder: '#e2e8f0',
	chipActive: '#2563eb',
	chipInactive: '#e2e8f0',
	focusRing: '#2563eb',
	config: '#2563eb',
	configLight: '#3b82f6',
	state: '#16a34a',
	stateLight: '#22c55e',
	other: '#64748b',
	rel: {
		orchestrates: '#d97706',
		observes: '#16a34a',
		deploys: '#059669',
		references: '#2563eb',
		member: '#0891b2',
		memberOf: '#0e7490',
		bindsTo: '#7c3aed',
		appliesTo: '#e11d48',
		extends: '#db2777'
	}
};

const dark: GraphPalette = {
	background: '#0f172a',
	gridDot: '#334155',
	panel: '#1e293b',
	panelBorder: '#334155',
	text: '#f1f5f9',
	textMuted: '#94a3b8',
	link: '#64748b',
	linkHighlight: '#60a5fa',
	linkDim: '#334155',
	nodeStroke: '#e2e8f0',
	nodeLabel: '#f8fafc',
	nodeLabelBg: 'rgba(15, 23, 42, 0.94)',
	tooltipBg: '#1e293b',
	tooltipBorder: '#475569',
	chipActive: '#3b82f6',
	chipInactive: '#334155',
	focusRing: '#60a5fa',
	config: '#3b82f6',
	configLight: '#60a5fa',
	state: '#22c55e',
	stateLight: '#4ade80',
	other: '#94a3b8',
	rel: {
		orchestrates: '#fbbf24',
		observes: '#4ade80',
		deploys: '#34d399',
		references: '#60a5fa',
		member: '#22d3ee',
		memberOf: '#06b6d4',
		bindsTo: '#a78bfa',
		appliesTo: '#fb7185',
		extends: '#f472b6'
	}
};

export function getGraphPalette(mode: ThemeMode): GraphPalette {
	return mode === 'dark' ? dark : light;
}

export function nodeFill(type: NodeType, palette: GraphPalette): string {
	switch (type) {
		case 'config':
			return palette.config;
		case 'state':
			return palette.state;
		default:
			return palette.other;
	}
}

export function nodeFillLight(type: NodeType, palette: GraphPalette): string {
	switch (type) {
		case 'config':
			return palette.configLight;
		case 'state':
			return palette.stateLight;
		default:
			return palette.other;
	}
}

export const REL_LABELS: Record<LinkRelation, string> = {
	observes: 'observes',
	deploys: 'deploys',
	references: 'references',
	member: 'member',
	memberOf: 'member of',
	bindsTo: 'binds to',
	appliesTo: 'applies to',
	orchestrates: 'orchestrates',
	extends: 'extends'
};

/** Primary intent relations shown in the compact canvas legend */
export const LEGEND_REL_ORDER: LinkRelation[] = [
	'orchestrates',
	'observes',
	'references',
	'bindsTo',
	'appliesTo'
];

export const REL_ORDER: LinkRelation[] = [
	'orchestrates',
	'observes',
	'deploys',
	'bindsTo',
	'appliesTo',
	'references',
	'member',
	'memberOf',
	'extends'
];
