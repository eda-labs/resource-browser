import type { ThemeMode } from '$lib/theme';
import type { LinkRelation, NodeType } from './types';

export type GraphPalette = {
	background: string;
	panel: string;
	panelBorder: string;
	text: string;
	textMuted: string;
	link: string;
	linkHighlight: string;
	linkDim: string;
	nodeStroke: string;
	nodeLabel: string;
	tooltipBg: string;
	tooltipBorder: string;
	chipActive: string;
	chipInactive: string;
	config: string;
	state: string;
	other: string;
	rel: Record<LinkRelation, string>;
};

const light: GraphPalette = {
	background: '#f8fafc',
	panel: '#ffffff',
	panelBorder: '#e2e8f0',
	text: '#0f172a',
	textMuted: '#64748b',
	link: '#94a3b8',
	linkHighlight: '#2563eb',
	linkDim: '#cbd5e1',
	nodeStroke: '#cbd5e1',
	nodeLabel: '#334155',
	tooltipBg: '#ffffff',
	tooltipBorder: '#e2e8f0',
	chipActive: '#2563eb',
	chipInactive: '#e2e8f0',
	config: '#3b82f6',
	state: '#8b5cf6',
	other: '#64748b',
	rel: {
		observes: '#8b5cf6',
		uses: '#2563eb',
		member: '#0891b2',
		deploys: '#059669',
		references: '#64748b'
	}
};

const dark: GraphPalette = {
	background: '#0f172a',
	panel: '#1e293b',
	panelBorder: '#334155',
	text: '#f1f5f9',
	textMuted: '#94a3b8',
	link: '#475569',
	linkHighlight: '#60a5fa',
	linkDim: '#334155',
	nodeStroke: '#475569',
	nodeLabel: '#cbd5e1',
	tooltipBg: '#1e293b',
	tooltipBorder: '#475569',
	chipActive: '#3b82f6',
	chipInactive: '#334155',
	config: '#60a5fa',
	state: '#a78bfa',
	other: '#94a3b8',
	rel: {
		observes: '#a78bfa',
		uses: '#60a5fa',
		member: '#22d3ee',
		deploys: '#34d399',
		references: '#94a3b8'
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
