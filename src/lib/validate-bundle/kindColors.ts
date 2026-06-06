const KIND_COLORS: Record<string, string> = {
	Topology: '#2563eb',
	TopoNode: '#0891b2',
	Interface: '#7c3aed',
	NetworkInstance: '#d97706',
	Router: '#059669',
	Fabric: '#db2777',
	Policy: '#e11d48',
	default: '#64748b'
};

export function kindColor(kind: string): string {
	return KIND_COLORS[kind] ?? KIND_COLORS.default;
}

export function kindTextColor(kind: string): string {
	return '#f8fafc';
}
