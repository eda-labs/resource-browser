import {
	drag,
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	select,
	zoom,
	zoomIdentity,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
	type ZoomBehavior
} from 'd3';
import { escapeHtml } from '$lib/comparison/highlight';
import { getGraphPalette, nodeFill, nodeFillLight, REL_LABELS } from './graphColors';
import type { GraphLink, GraphNode, LinkRelation } from './types';
import { getHighlightSets, type ChainMode } from './transitiveClosure';

type SimNode = GraphNode &
	SimulationNodeDatum & {
		upstreamDepth?: number | null;
		downstreamDepth?: number | null;
	};
type SimLink = Omit<GraphLink, 'source' | 'target'> &
	SimulationLinkDatum<SimNode> & {
		source: SimNode | string;
		target: SimNode | string;
	};

const FOCUS_RADIUS = 26;
const NODE_RADIUS = 18;
const STATE_RADIUS = 15;
const RING_GAP = 140;
const INNER_RING = 120;
const NODE_SEPARATION = 56;
const LABEL_MAX_CHARS = 18;
const CANVAS_MIN_HEIGHT = 360;
const FIT_PADDING_X = 80;
const FIT_PADDING_TOP = 96;
const FIT_PADDING_BOTTOM = 80;

export type GraphControllerOptions = {
	container: HTMLDivElement;
	svg: SVGSVGElement;
	tooltip: HTMLDivElement;
	getFilteredNodes: () => GraphNode[];
	getFilteredLinks: () => GraphLink[];
	radialLayout: boolean;
	theme: 'light' | 'dark';
	onSelect: (id: string | null) => void;
	getSelectedId: () => string | null;
	getChainMode: () => ChainMode;
	getCenterNodeId?: () => string | null;
};

export type GraphController = {
	rebuild: () => void;
	updateTheme: (theme: 'light' | 'dark') => void;
	updateHighlight: () => void;
	focusNode: (id: string) => void;
	fitToScreen: () => void;
	showFullExtent: () => void;
	reflowLayout: () => void;
	zoomIn: () => void;
	zoomOut: () => void;
	setRadial: (radial: boolean) => void;
	destroy: () => void;
};

function truncateLabel(text: string, max = LABEL_MAX_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trim()}…`;
}

function endpointId(endpoint: SimNode | string): string {
	return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

function buildAdjacency(links: SimLink[]) {
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const link of links) {
		const s = endpointId(link.source);
		const t = endpointId(link.target);
		(outgoing.get(s) ?? outgoing.set(s, []).get(s)!).push(t);
		(incoming.get(t) ?? incoming.set(t, []).get(t)!).push(s);
	}
	return { incoming, outgoing };
}

function bfsDepth(startId: string, adjacency: Map<string, string[]>): Map<string, number> {
	const depths = new Map<string, number>();
	const queue = [startId];
	depths.set(startId, 0);
	while (queue.length > 0) {
		const current = queue.shift()!;
		const depth = depths.get(current)!;
		for (const next of adjacency.get(current) ?? []) {
			if (depths.has(next)) continue;
			depths.set(next, depth + 1);
			queue.push(next);
		}
	}
	depths.delete(startId);
	return depths;
}

function placeArc(
	ids: string[],
	cx: number,
	cy: number,
	radius: number,
	startAngle: number,
	endAngle: number,
	positions: Map<string, { x: number; y: number }>
) {
	if (ids.length === 0) return;
	const safeRadius = Math.max(radius, 48);
	const minAngle = 2 * Math.asin(Math.min(1, NODE_SEPARATION / (2 * safeRadius)));
	const neededSpan = minAngle * Math.max(ids.length - 1, 1);
	let arcStart = startAngle;
	let arcEnd = endAngle;
	const baseSpan = arcEnd - arcStart;
	if (neededSpan > baseSpan) {
		const mid = (startAngle + endAngle) / 2;
		arcStart = mid - neededSpan / 2;
		arcEnd = mid + neededSpan / 2;
	}
	const span = arcEnd - arcStart;
	ids.forEach((id, i) => {
		const t = ids.length === 1 ? 0.5 : (i + 1) / (ids.length + 1);
		const angle = arcStart + span * t;
		positions.set(id, {
			x: cx + safeRadius * Math.cos(angle),
			y: cy + safeRadius * Math.sin(angle)
		});
	});
}

function maxRingDepth(
	upstreamByRing: Map<number, string[]>,
	downstreamByRing: Map<number, string[]>,
	bridgeByRing: Map<number, string[]>
): number {
	const depths = [
		...upstreamByRing.keys(),
		...downstreamByRing.keys(),
		...bridgeByRing.keys()
	];
	return depths.length > 0 ? Math.max(...depths) : 1;
}

function computeRadialPositions(
	nodes: SimNode[],
	links: SimLink[],
	centerId: string | null,
	width: number,
	height: number
): Map<string, { x: number; y: number }> {
	const cx = width / 2;
	const cy = height / 2;
	const positions = new Map<string, { x: number; y: number }>();

	if (!centerId || nodes.length === 0) {
		const radius = Math.max(INNER_RING, Math.min(width, height) * 0.38);
		placeArc(
			nodes.map((n) => n.id),
			cx,
			cy,
			radius,
			-Math.PI * 0.85,
			Math.PI * 0.85,
			positions
		);
		return positions;
	}

	positions.set(centerId, { x: cx, y: cy });
	const { incoming, outgoing } = buildAdjacency(links);
	const upDepth = bfsDepth(centerId, incoming);
	const downDepth = bfsDepth(centerId, outgoing);

	const upstreamByRing = new Map<number, string[]>();
	const downstreamByRing = new Map<number, string[]>();
	const bridgeByRing = new Map<number, string[]>();
	const orphan: string[] = [];

	for (const node of nodes) {
		if (node.id === centerId) continue;
		const ud = upDepth.get(node.id);
		const dd = downDepth.get(node.id);
		node.upstreamDepth = ud ?? null;
		node.downstreamDepth = dd ?? null;

		if (ud !== undefined && dd !== undefined) {
			const depth = Math.max(ud, dd);
			bridgeByRing.set(depth, [...(bridgeByRing.get(depth) ?? []), node.id]);
		} else if (ud !== undefined) {
			upstreamByRing.set(ud, [...(upstreamByRing.get(ud) ?? []), node.id]);
		} else if (dd !== undefined) {
			downstreamByRing.set(dd, [...(downstreamByRing.get(dd) ?? []), node.id]);
		} else {
			orphan.push(node.id);
		}
	}

	const innerRing = INNER_RING;
	const ringGap = RING_GAP;

	for (const [depth, ids] of upstreamByRing) {
		const radius = innerRing + (depth - 1) * ringGap;
		placeArc(ids, cx, cy, radius, Math.PI * 0.52, Math.PI * 1.48, positions);
	}

	for (const [depth, ids] of downstreamByRing) {
		const radius = innerRing + (depth - 1) * ringGap;
		placeArc(ids, cx, cy, radius, -Math.PI * 0.48, Math.PI * 0.48, positions);
	}

	for (const [depth, ids] of bridgeByRing) {
		const radius = innerRing + (depth - 1) * ringGap + ringGap * 0.4;
		const top = ids.filter((_, i) => i % 2 === 0);
		const bottom = ids.filter((_, i) => i % 2 === 1);
		placeArc(top, cx, cy, radius, -Math.PI * 0.22, Math.PI * 0.22, positions);
		placeArc(bottom, cx, cy, radius, Math.PI * 0.78, Math.PI * 1.22, positions);
	}

	if (orphan.length > 0) {
		const maxDepth = maxRingDepth(upstreamByRing, downstreamByRing, bridgeByRing);
		const radius = innerRing + maxDepth * ringGap + ringGap * 0.65;
		placeArc(orphan, cx, cy, radius, -Math.PI * 0.9, Math.PI * 0.9, positions);
	}

	return positions;
}

function nodeRadius(d: SimNode, centerId: string | null): number {
	if (centerId && d.id === centerId) return FOCUS_RADIUS;
	return d.type === 'state' ? STATE_RADIUS : NODE_RADIUS;
}

function countRels(nodeId: string, links: SimLink[]) {
	let inCount = 0;
	let outCount = 0;
	for (const link of links) {
		const s = endpointId(link.source);
		const t = endpointId(link.target);
		if (t === nodeId) inCount++;
		if (s === nodeId) outCount++;
	}
	return { inCount, outCount };
}

export function createGraphController(options: GraphControllerOptions): GraphController {
	let {
		container,
		svg,
		tooltip,
		onSelect,
		getSelectedId,
		getChainMode,
		getFilteredNodes,
		getFilteredLinks,
		getCenterNodeId
	} = options;
	let radialLayout = options.radialLayout;
	let theme = options.theme;

	let width = 800;
	let height = 600;
	let viewportWidth = 800;
	let viewportHeight = 600;
	let palette = getGraphPalette(theme);
	let simulation: Simulation<SimNode, SimLink> | null = null;
	let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let gRoot: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let linkSel: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let nodeSel: any = null;
	let simNodes: SimNode[] = [];
	let simLinks: SimLink[] = [];
	let hoveredLinkId: string | null = null;
	let hoveredNodeId: string | null = null;
	let resizeObserver: ResizeObserver | null = null;

	function relColor(rel: LinkRelation): string {
		return palette.rel[rel] ?? palette.link;
	}

	function getNodeBounds() {
		if (simNodes.length === 0) return null;
		const centerId = getCenterNodeId?.() ?? null;
		const labelPad = 42;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const n of simNodes) {
			const x = n.x ?? 0;
			const y = n.y ?? 0;
			const r = nodeRadius(n, centerId) + 10;
			minX = Math.min(minX, x - r);
			maxX = Math.max(maxX, x + r);
			minY = Math.min(minY, y - r);
			maxY = Math.max(maxY, y + r + labelPad);
		}
		return { minX, maxX, minY, maxY };
	}

	function centerGraphInCanvas(targetW: number, targetH: number) {
		const bounds = getNodeBounds();
		if (!bounds || simNodes.length === 0) return;
		const graphW = bounds.maxX - bounds.minX;
		const graphH = bounds.maxY - bounds.minY;
		const offsetX = (targetW - graphW) / 2 - bounds.minX;
		const offsetY = (targetH - graphH) / 2 - bounds.minY;
		if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) return;
		for (const node of simNodes) {
			node.x = (node.x ?? 0) + offsetX;
			node.y = (node.y ?? 0) + offsetY;
			if (radialLayout) {
				node.fx = node.x;
				node.fy = node.y;
			}
		}
	}

	function measureWidth() {
		const parent = container.parentElement;
		const parentWidth =
			parent?.getBoundingClientRect().width ?? container.getBoundingClientRect().width;
		viewportWidth = Math.max(parentWidth, 1);
		width = viewportWidth;
	}

	function measureViewportHeight() {
		const rect = container.getBoundingClientRect();
		const cssMin = Number.parseFloat(getComputedStyle(container).minHeight) || 0;
		const fallback = Math.min(window.innerHeight * 0.48, 576);
		viewportHeight = Math.max(
			CANVAS_MIN_HEIGHT,
			rect.height,
			cssMin,
			fallback
		);
		height = viewportHeight;
	}

	function updateSvgDimensions() {
		select(svg)
			.attr('width', width)
			.attr('height', height)
			.style('width', `${width}px`)
			.style('height', `${height}px`);
	}

	function measureViewport() {
		measureWidth();
		measureViewportHeight();
		container.style.width = '100%';
		container.style.height = `${viewportHeight}px`;
		container.style.minWidth = '';
		updateSvgDimensions();
	}

	function applyContentSize() {
		const bounds = getNodeBounds();
		if (!bounds) return;

		measureWidth();
		const contentW = bounds.maxX - bounds.minX + FIT_PADDING_X * 2;
		const contentH = bounds.maxY - bounds.minY + FIT_PADDING_TOP + FIT_PADDING_BOTTOM;
		const targetW = Math.max(viewportWidth, contentW);
		const targetH = Math.max(viewportHeight, contentH);
		centerGraphInCanvas(targetW, targetH);
		width = targetW;
		height = targetH;
		container.style.minWidth = width > viewportWidth + 2 ? `${width}px` : '';
		container.style.height = `${height}px`;
		updateSvgDimensions();
	}

	function measure() {
		measureViewport();
	}

	function reflowRadialPositions() {
		const centerId = getCenterNodeId?.() ?? null;
		const positions = computeRadialPositions(simNodes, simLinks, centerId, width, height);
		applyPositions(positions, simNodes);
		linkSel?.attr('d', linkPath);
		nodeSel?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
	}

	function finalizeLayoutSize() {
		measureViewport();
		if (radialLayout && simNodes.length > 0) {
			reflowRadialPositions();
		}
		applyContentSize();
	}

	function applyPositions(positions: Map<string, { x: number; y: number }>, nodes: SimNode[]) {
		for (const node of nodes) {
			const pos = positions.get(node.id);
			if (pos) {
				node.x = pos.x;
				node.y = pos.y;
				if (radialLayout) {
					node.fx = pos.x;
					node.fy = pos.y;
				}
			}
		}
	}

	function clearFixedPositions(nodes: SimNode[]) {
		for (const node of nodes) {
			node.fx = null;
			node.fy = null;
		}
	}

	function linkPath(d: SimLink): string {
		const centerId = getCenterNodeId?.() ?? null;
		const source = d.source as SimNode;
		const target = d.target as SimNode;
		const sx = source.x ?? 0;
		const sy = source.y ?? 0;
		const tx = target.x ?? 0;
		const ty = target.y ?? 0;
		const dx = tx - sx;
		const dy = ty - sy;
		const dist = Math.hypot(dx, dy) || 1;
		const trimStart = nodeRadius(source, centerId) + 5;
		const trimEnd = nodeRadius(target, centerId) + 8;
		const endX = tx - (dx / dist) * trimEnd;
		const endY = ty - (dy / dist) * trimEnd;
		const startX = sx + (dx / dist) * trimStart;
		const startY = sy + (dy / dist) * trimStart;
		const curve = Math.min(52, Math.max(14, dist * 0.14));
		const sign = d.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
		const mx = (startX + endX) / 2 + (-dy / dist) * curve * sign;
		const my = (startY + endY) / 2 + (dx / dist) * curve * sign;
		return `M${startX},${startY} Q${mx},${my} ${endX},${endY}`;
	}

	function updateHighlight() {
		const selectedId = getSelectedId();
		if (!linkSel || !nodeSel) return;

		const nodes = getFilteredNodes();
		const links = getFilteredLinks();
		const filteredNodeIds = new Set(nodes.map((n) => n.id));
		const highlight = selectedId
			? getHighlightSets(selectedId, links, getChainMode(), filteredNodeIds)
			: null;
		const centerId = getCenterNodeId?.() ?? null;

		linkSel
			.attr('stroke', (d: SimLink) => {
				if (hoveredLinkId === d.id) return relColor(d.rel);
				if (!highlight) return relColor(d.rel);
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				return highlight.isHighlightedEdge(s, t) ? relColor(d.rel) : palette.linkDim;
			})
			.attr('stroke-opacity', (d: SimLink) => {
				if (hoveredLinkId === d.id) return 1;
				if (!highlight) return 0.88;
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				return highlight.isHighlightedEdge(s, t) ? 0.95 : 0.18;
			})
			.attr('stroke-width', (d: SimLink) => {
				if (hoveredLinkId === d.id) return 2.75;
				if (!highlight) return 1.75;
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				return highlight.isHighlightedEdge(s, t) ? 2.25 : 1;
			})
			.attr('marker-end', (d: SimLink) => {
				if (!highlight && hoveredLinkId !== d.id) return `url(#dep-arrow-${d.rel})`;
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				const active = !highlight || highlight.isHighlightedEdge(s, t) || hoveredLinkId === d.id;
				return active ? `url(#dep-arrow-${d.rel})` : 'url(#dep-arrow-dim)';
			});

		nodeSel.select('.dep-node-shape').attr('opacity', (d: SimNode) => {
			if (hoveredNodeId === d.id) return 1;
			if (!highlight) return 1;
			return highlight.nodes.has(d.id) ? 1 : 0.48;
		});

		nodeSel.select('.dep-node-ring').attr('opacity', (d: SimNode) => {
			const isFocus = centerId && d.id === centerId;
			const isSelected = selectedId === d.id;
			const isHovered = hoveredNodeId === d.id;
			if (isFocus) return 0.95;
			if (isSelected) return 0.85;
			if (isHovered) return 0.7;
			return 0;
		});

		nodeSel.select('.dep-node-shape').attr('stroke-width', (d: SimNode) => {
			if (centerId && d.id === centerId) return 3;
			if (selectedId === d.id || hoveredNodeId === d.id) return 2.75;
			return 2.25;
		});

		nodeSel.select('.dep-node-label-group').attr('opacity', (d: SimNode) => {
			if (hoveredNodeId === d.id) return 1;
			if (!highlight) return 1;
			return highlight.nodes.has(d.id) ? 1 : 0.55;
		});

		nodeSel.attr('class', (d: SimNode) => {
			const classes = ['dep-node'];
			if (hoveredNodeId === d.id) classes.push('dep-node--hover');
			if (selectedId === d.id) classes.push('dep-node--selected');
			if (centerId && d.id === centerId) classes.push('dep-node--focus');
			return classes.join(' ');
		});
	}

	function fitToScreen() {
		if (!zoomBehavior || simNodes.length === 0) return;
		const bounds = getNodeBounds();
		if (!bounds) return;
		const { minX, minY } = bounds;
		const dx = bounds.maxX - bounds.minX || 1;
		const dy = bounds.maxY - bounds.minY || 1;
		const availableW = viewportWidth - FIT_PADDING_X * 2;
		const availableH = viewportHeight - FIT_PADDING_TOP - FIT_PADDING_BOTTOM;
		const scale = Math.min(availableW / dx, availableH / dy, 3.2);
		const tx = FIT_PADDING_X + (availableW - scale * dx) / 2 - scale * minX;
		const ty = FIT_PADDING_TOP + (availableH - scale * dy) / 2 - scale * minY;
		if (!Number.isFinite(scale) || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
		select(svg)
			.transition()
			.duration(550)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
	}

	function scheduleFitToScreen() {
		requestAnimationFrame(() => {
			finalizeLayoutSize();
			requestAnimationFrame(() => fitToScreen());
		});
	}

	function reflowForResize() {
		if (simNodes.length === 0) return;
		finalizeLayoutSize();
		fitToScreen();
	}

	function showFullExtent() {
		if (!zoomBehavior) return;
		select(svg)
			.transition()
			.duration(450)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity);
	}

	function setupResizeObserver() {
		resizeObserver?.disconnect();
		const observeTarget = container.parentElement ?? container;
		let lastObservedWidth = observeTarget.getBoundingClientRect().width;
		resizeObserver = new ResizeObserver(() => {
			const newWidth = observeTarget.getBoundingClientRect().width;
			if (Math.abs(newWidth - lastObservedWidth) > 2) {
				lastObservedWidth = newWidth;
				reflowForResize();
			}
		});
		resizeObserver.observe(observeTarget);
	}

	function focusNode(id: string) {
		const node = simNodes.find((n) => n.id === id);
		if (!node || !zoomBehavior || typeof node.x !== 'number' || typeof node.y !== 'number') return;
		const scale = 1.35;
		const tx = viewportWidth / 2 - node.x * scale;
		const ty = viewportHeight / 2 - node.y * scale;
		select(svg)
			.transition()
			.duration(450)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
	}

	function zoomBy(factor: number) {
		if (!zoomBehavior) return;
		select(svg)
			.transition()
			.duration(280)
			.call(zoomBehavior.scaleBy, factor);
	}

	function ensureDefs(root: ReturnType<typeof select>) {
		let defs = root.select('defs');
		if (defs.empty()) defs = root.append('defs');

		defs.selectAll('marker').remove();

		const rels: LinkRelation[] = [
			'orchestrates',
			'observes',
			'deploys',
			'references',
			'member',
			'memberOf',
			'bindsTo',
			'appliesTo',
			'extends'
		];

		for (const rel of rels) {
			defs
				.append('marker')
				.attr('id', `dep-arrow-${rel}`)
				.attr('viewBox', '0 -4 8 8')
				.attr('refX', 6)
				.attr('refY', 0)
				.attr('markerWidth', 5)
				.attr('markerHeight', 5)
				.attr('orient', 'auto')
				.append('path')
				.attr('d', 'M0,-4L8,0L0,4')
				.attr('fill', relColor(rel));
		}

		defs
			.append('marker')
			.attr('id', 'dep-arrow-dim')
			.attr('viewBox', '0 -4 8 8')
			.attr('refX', 6)
			.attr('refY', 0)
			.attr('markerWidth', 4)
			.attr('markerHeight', 4)
			.attr('orient', 'auto')
			.append('path')
			.attr('d', 'M0,-4L8,0L0,4')
			.attr('fill', palette.linkDim);

		defs.selectAll('#dep-node-shadow').remove();
		const shadow = defs.append('filter').attr('id', 'dep-node-shadow').attr('x', '-40%').attr('y', '-40%').attr('width', '180%').attr('height', '180%');
		shadow
			.append('feDropShadow')
			.attr('dx', 0)
			.attr('dy', 1.5)
			.attr('stdDeviation', 2.5)
			.attr('flood-color', theme === 'dark' ? '#020617' : '#0f172a')
			.attr('flood-opacity', theme === 'dark' ? 0.42 : 0.16);

		const gradients = defs.selectAll('#dep-node-gradients').data([0]);
		const gradRoot = gradients.enter().append('g').attr('id', 'dep-node-gradients').merge(gradients);

		gradRoot.selectAll('linearGradient').remove();

		for (const type of ['config', 'state', 'other'] as const) {
			const grad = gradRoot
				.append('linearGradient')
				.attr('id', `dep-node-grad-${type}`)
				.attr('x1', '0%')
				.attr('y1', '0%')
				.attr('x2', '0%')
				.attr('y2', '100%');
			grad.append('stop').attr('offset', '0%').attr('stop-color', nodeFillLight(type, palette));
			grad.append('stop').attr('offset', '100%').attr('stop-color', nodeFill(type, palette));
		}
	}

	function showTooltip(event: MouseEvent, html: string) {
		tooltip.style.opacity = '1';
		tooltip.innerHTML = html;
		tooltip.style.left = `${event.pageX + 14}px`;
		tooltip.style.top = `${event.pageY + 14}px`;
	}

	function hideTooltip() {
		tooltip.style.opacity = '0';
	}

	function rebuild() {
		simulation?.stop();
		measure();

		const filteredNodes = getFilteredNodes();
		const filteredLinks = getFilteredLinks();
		const centerId = getCenterNodeId?.() ?? null;

		simNodes = filteredNodes.map((n) => ({ ...n }));
		const nodeById = new Map(simNodes.map((n) => [n.id, n]));
		simLinks = filteredLinks
			.map((l) => ({
				...l,
				source: nodeById.get(typeof l.source === 'object' ? l.source.id : l.source)!,
				target: nodeById.get(typeof l.target === 'object' ? l.target.id : l.target)!
			}))
			.filter((l) => l.source && l.target);

		const root = select(svg);
		if (!gRoot) {
			root.selectAll('*').remove();
			root.attr('class', 'dep-map-svg dep-map-svg-inner');

			const gridPattern = root
				.append('defs')
				.append('pattern')
				.attr('id', 'dep-grid-pattern')
				.attr('width', 24)
				.attr('height', 24)
				.attr('patternUnits', 'userSpaceOnUse');
			gridPattern.append('circle').attr('cx', 1.5).attr('cy', 1.5).attr('r', 1.15).attr('class', 'dep-grid-dot');

			root.append('rect').attr('class', 'dep-map-bg').attr('width', '100%').attr('height', '100%');
			root
				.append('rect')
				.attr('class', 'dep-map-grid')
				.attr('width', '100%')
				.attr('height', '100%')
				.attr('fill', 'url(#dep-grid-pattern)')
				.attr('pointer-events', 'none');

			zoomBehavior = zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.12, 4])
				.on('zoom', (event) => {
					gRoot?.attr('transform', event.transform);
				});
			root.call(zoomBehavior).on('dblclick.zoom', null);
			gRoot = root.append('g').attr('class', 'dep-map-graph-root');
		} else {
			gRoot.selectAll('*').remove();
		}

		ensureDefs(root);
		root.select('.dep-grid-dot').attr('fill', palette.gridDot);
		root.select('.dep-map-bg').attr('fill', palette.background);

		linkSel = gRoot
			.append('g')
			.attr('class', 'dep-links')
			.selectAll('path')
			.data(simLinks, (d: SimLink) => d.id)
			.join('path')
			.attr('fill', 'none')
			.attr('stroke-linecap', 'round')
			.attr('marker-end', (d: SimLink) => `url(#dep-arrow-${d.rel})`)
			.on('mouseenter', (event: MouseEvent, d: SimLink) => {
				hoveredLinkId = d.id;
				updateHighlight();
				showTooltip(
					event,
					`<strong>${escapeHtml(REL_LABELS[d.rel] ?? d.rel)}</strong>`
				);
			})
			.on('mousemove', (event: MouseEvent) => {
				tooltip.style.left = `${event.pageX + 14}px`;
				tooltip.style.top = `${event.pageY + 14}px`;
			})
			.on('mouseleave', () => {
				hoveredLinkId = null;
				updateHighlight();
				hideTooltip();
			});

		const dragBehavior = drag<SVGGElement, SimNode>()
			.on('start', (event, d) => {
				if (!event.active) simulation?.alphaTarget(0.2).restart();
				d.fx = d.x;
				d.fy = d.y;
			})
			.on('drag', (event, d) => {
				d.fx = event.x;
				d.fy = event.y;
			})
			.on('end', (event, d) => {
				if (!event.active) simulation?.alphaTarget(0);
				if (!radialLayout) {
					d.fx = null;
					d.fy = null;
				}
			});

		nodeSel = gRoot
			.append('g')
			.attr('class', 'dep-nodes')
			.selectAll('g')
			.data(simNodes, (d: SimNode) => d.id)
			.join('g')
			.attr('class', 'dep-node')
			.attr('cursor', 'pointer')
			.call(dragBehavior);

		nodeSel
			.append('circle')
			.attr('class', 'dep-node-ring')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId) + 7)
			.attr('fill', 'none')
			.attr('stroke', palette.focusRing)
			.attr('stroke-width', 3)
			.attr('opacity', (d: SimNode) => (centerId && d.id === centerId ? 0.9 : 0));

		nodeSel
			.append('circle')
			.attr('class', 'dep-node-shape')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId))
			.attr('fill', (d: SimNode) => `url(#dep-node-grad-${d.type === 'config' || d.type === 'state' ? d.type : 'other'})`)
			.attr('stroke', palette.nodeStroke)
			.attr('stroke-width', (d: SimNode) => (centerId && d.id === centerId ? 3 : 2.25))
			.attr('filter', 'url(#dep-node-shadow)')
			.on('click', (_: unknown, d: SimNode) => {
				const current = getSelectedId();
				onSelect(d.id === current ? null : d.id);
				updateHighlight();
			})
			.on('mouseenter', (event: MouseEvent, d: SimNode) => {
				hoveredNodeId = d.id;
				updateHighlight();
				const { inCount, outCount } = countRels(d.id, simLinks);
				showTooltip(
					event,
					`<strong>${escapeHtml(d.kind || d.shortName)}</strong>` +
						`<br/><span style="opacity:0.75">${escapeHtml(d.group)}</span>` +
						`<br/><span style="opacity:0.75">${escapeHtml(d.type)} · ${inCount} in · ${outCount} out</span>`
				);
			})
			.on('mousemove', (event: MouseEvent) => {
				tooltip.style.left = `${event.pageX + 14}px`;
				tooltip.style.top = `${event.pageY + 14}px`;
			})
			.on('mouseleave', () => {
				hoveredNodeId = null;
				updateHighlight();
				hideTooltip();
			});

		const labelGroups = nodeSel.append('g').attr('class', 'dep-node-label-group').attr('pointer-events', 'none');

		labelGroups.each(function (this: SVGGElement, d: SimNode) {
			const g = select(this);
			const r = nodeRadius(d, centerId);
			const label = truncateLabel(d.kind || d.shortName);
			const text = g
				.append('text')
				.attr('class', 'dep-node-label')
				.attr('text-anchor', 'middle')
				.attr('y', r + 22)
				.attr('font-size', centerId && d.id === centerId ? '13px' : '12px')
				.attr('font-weight', 700)
				.attr('fill', palette.nodeLabel)
				.text(label);

			const bbox = (text.node() as SVGTextElement).getBBox();
			g.insert('rect', 'text')
				.attr('class', 'dep-node-label-bg')
				.attr('x', bbox.x - 6)
				.attr('y', bbox.y - 3)
				.attr('width', bbox.width + 12)
				.attr('height', bbox.height + 6)
				.attr('rx', 5)
				.attr('fill', palette.nodeLabelBg)
				.attr('stroke', palette.panelBorder)
				.attr('stroke-width', 1);
		});

		const positions = computeRadialPositions(simNodes, simLinks, centerId, width, height);
		applyPositions(positions, simNodes);

		if (radialLayout) {
			simulation = null;
			linkSel.attr('d', linkPath);
			nodeSel.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			updateHighlight();
			scheduleFitToScreen();
		} else {
			clearFixedPositions(simNodes);
			simulation = forceSimulation(simNodes)
				.force(
					'link',
					forceLink<SimNode, SimLink>(simLinks)
						.id((d) => d.id)
						.distance(150)
						.strength(0.24)
				)
				.force('charge', forceManyBody().strength(-420))
				.force('center', forceCenter(viewportWidth / 2, viewportHeight / 2))
				.force('collision', forceCollide<SimNode>().radius((d) => nodeRadius(d, centerId) + 32))
				.alphaDecay(0.045)
				.velocityDecay(0.55);

			simulation.on('tick', () => {
				linkSel?.attr('d', linkPath);
				nodeSel?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			});

			updateHighlight();
			simulation.on('end', () => scheduleFitToScreen());
		}

		setupResizeObserver();
	}

	return {
		rebuild,
		updateTheme(nextTheme: 'light' | 'dark') {
			theme = nextTheme;
			palette = getGraphPalette(theme);
			const root = select(svg);
			root.select('.dep-grid-dot').attr('fill', palette.gridDot);
			root.select('.dep-map-bg').attr('fill', palette.background);
			ensureDefs(root);
			nodeSel?.select('.dep-node-shape').attr('stroke', palette.nodeStroke);
			nodeSel?.select('.dep-node-ring').attr('stroke', palette.focusRing);
			nodeSel?.select('.dep-node-label').attr('fill', palette.nodeLabel);
			nodeSel?.select('.dep-node-label-bg').attr('fill', palette.nodeLabelBg).attr('stroke', palette.panelBorder);
			updateHighlight();
		},
		updateHighlight,
		focusNode,
		fitToScreen,
		showFullExtent,
		reflowLayout: reflowForResize,
		zoomIn: () => zoomBy(1.28),
		zoomOut: () => zoomBy(1 / 1.28),
		setRadial(radial: boolean) {
			radialLayout = radial;
			rebuild();
		},
		destroy() {
			resizeObserver?.disconnect();
			resizeObserver = null;
			simulation?.stop();
		}
	};
}
