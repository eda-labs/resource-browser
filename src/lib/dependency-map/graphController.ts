import { drag } from 'd3-drag';
import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum
} from 'd3-force';
import { linkHorizontal } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
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

const FOCUS_RADIUS = 18;
const NODE_RADIUS = 12;
const STATE_RADIUS = 10;
const RING_GAP = 95;
const INNER_RING = 88;
const LABEL_MAX_CHARS = 16;

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
	const span = endAngle - startAngle;
	ids.forEach((id, i) => {
		const t = ids.length === 1 ? 0.5 : (i + 1) / (ids.length + 1);
		const angle = startAngle + span * t;
		positions.set(id, {
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle)
		});
	});
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
		const radius = Math.min(width, height) * 0.34;
		const step = (2 * Math.PI) / Math.max(nodes.length, 1);
		nodes.forEach((node, i) => {
			const angle = i * step - Math.PI / 2;
			positions.set(node.id, {
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle)
			});
		});
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

	for (const [depth, ids] of upstreamByRing) {
		const radius = INNER_RING + (depth - 1) * RING_GAP;
		placeArc(ids, cx, cy, radius, Math.PI * 0.55, Math.PI * 1.45, positions);
	}

	for (const [depth, ids] of downstreamByRing) {
		const radius = INNER_RING + (depth - 1) * RING_GAP;
		placeArc(ids, cx, cy, radius, -Math.PI * 0.45, Math.PI * 0.45, positions);
	}

	for (const [depth, ids] of bridgeByRing) {
		const radius = INNER_RING + (depth - 1) * RING_GAP + RING_GAP * 0.35;
		const top = ids.filter((_, i) => i % 2 === 0);
		const bottom = ids.filter((_, i) => i % 2 === 1);
		placeArc(top, cx, cy, radius, -Math.PI * 0.12, Math.PI * 0.12, positions);
		placeArc(bottom, cx, cy, radius, Math.PI * 0.88, Math.PI * 1.12, positions);
	}

	if (orphan.length > 0) {
		const radius = Math.min(width, height) * 0.42;
		placeArc(orphan, cx, cy, radius, 0, 2 * Math.PI, positions);
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

	const linkGen = linkHorizontal<SimLink, SimNode>()
		.x((d) => d.x ?? 0)
		.y((d) => d.y ?? 0);

	function relColor(rel: LinkRelation): string {
		return palette.rel[rel] ?? palette.link;
	}

	function measure() {
		const rect = container.getBoundingClientRect();
		width = Math.max(rect.width, 320);
		height = Math.max(rect.height, 400);
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
		const sx = (d.source as SimNode).x ?? 0;
		const sy = (d.source as SimNode).y ?? 0;
		const tx = (d.target as SimNode).x ?? 0;
		const ty = (d.target as SimNode).y ?? 0;
		const dx = tx - sx;
		const dy = ty - sy;
		const dist = Math.hypot(dx, dy) || 1;
		const trim = 14;
		const endX = tx - (dx / dist) * trim;
		const endY = ty - (dy / dist) * trim;
		const startX = sx + (dx / dist) * trim;
		const startY = sy + (dy / dist) * trim;
		return (
			linkGen({
				...d,
				source: { ...(d.source as SimNode), x: startX, y: startY },
				target: { ...(d.target as SimNode), x: endX, y: endY }
			}) ?? ''
		);
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
				if (!highlight) return 0.72;
				const s = endpointId(d.source);
				const t = endpointId(d.target);
				return highlight.isHighlightedEdge(s, t) ? 0.95 : 0.18;
			})
			.attr('stroke-width', (d: SimLink) => {
				if (hoveredLinkId === d.id) return 2.75;
				if (!highlight) return 1.35;
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
			return isFocus || isSelected || hoveredNodeId === d.id ? 1 : 0;
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
		const padding = 56;
		const labelPad = 28;
		const xs = simNodes.map((n) => n.x ?? 0);
		const ys = simNodes.map((n) => (n.y ?? 0) - labelPad).concat(simNodes.map((n) => (n.y ?? 0) + labelPad));
		const allXs = xs;
		const allYs = ys;
		const minX = Math.min(...allXs);
		const maxX = Math.max(...allXs);
		const minY = Math.min(...allYs);
		const maxY = Math.max(...allYs);
		const dx = maxX - minX || 1;
		const dy = maxY - minY || 1;
		const scale = Math.min((width - padding * 2) / dx, (height - padding * 2) / dy, 2.2);
		const tx = width / 2 - (scale * (minX + maxX)) / 2;
		const ty = height / 2 - (scale * (minY + maxY)) / 2;
		select(svg)
			.transition()
			.duration(550)
			.ease((t) => 1 - Math.pow(1 - t, 3))
			.call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(scale));
	}

	function focusNode(id: string) {
		const node = simNodes.find((n) => n.id === id);
		if (!node || !zoomBehavior || typeof node.x !== 'number' || typeof node.y !== 'number') return;
		const scale = 1.35;
		const tx = width / 2 - node.x * scale;
		const ty = height / 2 - node.y * scale;
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
			root.attr('class', 'dep-map-svg-inner');

			const gridPattern = root
				.append('defs')
				.append('pattern')
				.attr('id', 'dep-grid-pattern')
				.attr('width', 20)
				.attr('height', 20)
				.attr('patternUnits', 'userSpaceOnUse');
			gridPattern.append('circle').attr('cx', 1).attr('cy', 1).attr('r', 1).attr('class', 'dep-grid-dot');

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
				showTooltip(event, `<strong>${REL_LABELS[d.rel] ?? d.rel}</strong>`);
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
			.attr('r', (d: SimNode) => nodeRadius(d, centerId) + 5)
			.attr('fill', 'none')
			.attr('stroke', palette.focusRing)
			.attr('stroke-width', 2.5)
			.attr('opacity', (d: SimNode) => (centerId && d.id === centerId ? 0.85 : 0));

		nodeSel
			.append('circle')
			.attr('class', 'dep-node-shape')
			.attr('r', (d: SimNode) => nodeRadius(d, centerId))
			.attr('fill', (d: SimNode) => `url(#dep-node-grad-${d.type === 'config' || d.type === 'state' ? d.type : 'other'})`)
			.attr('stroke', palette.nodeStroke)
			.attr('stroke-width', (d: SimNode) => (centerId && d.id === centerId ? 2.5 : 1.75))
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
					`<strong>${d.kind || d.shortName}</strong><br/><span style="opacity:0.75">${d.group}</span><br/><span style="opacity:0.75">${d.type} · ${inCount} in · ${outCount} out</span>`
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
				.attr('y', r + 16)
				.attr('font-size', centerId && d.id === centerId ? '11px' : '10px')
				.attr('font-weight', 600)
				.attr('fill', palette.nodeLabel)
				.text(label);

			const bbox = (text.node() as SVGTextElement).getBBox();
			g.insert('rect', 'text')
				.attr('class', 'dep-node-label-bg')
				.attr('x', bbox.x - 4)
				.attr('y', bbox.y - 2)
				.attr('width', bbox.width + 8)
				.attr('height', bbox.height + 4)
				.attr('rx', 4)
				.attr('fill', palette.nodeLabelBg)
				.attr('stroke', palette.panelBorder)
				.attr('stroke-width', 0.75);
		});

		const positions = computeRadialPositions(simNodes, simLinks, centerId, width, height);
		applyPositions(positions, simNodes);

		if (radialLayout) {
			simulation = null;
			linkSel.attr('d', linkPath);
			nodeSel.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			updateHighlight();
			requestAnimationFrame(() => fitToScreen());
		} else {
			clearFixedPositions(simNodes);
			simulation = forceSimulation(simNodes)
				.force(
					'link',
					forceLink<SimNode, SimLink>(simLinks)
						.id((d) => d.id)
						.distance(110)
						.strength(0.28)
				)
				.force('charge', forceManyBody().strength(-280))
				.force('center', forceCenter(width / 2, height / 2))
				.force('collision', forceCollide<SimNode>().radius((d) => nodeRadius(d, centerId) + 22))
				.alphaDecay(0.045)
				.velocityDecay(0.55);

			simulation.on('tick', () => {
				linkSel?.attr('d', linkPath);
				nodeSel?.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
			});

			updateHighlight();
			simulation.on('end', () => fitToScreen());
		}
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
		zoomIn: () => zoomBy(1.28),
		zoomOut: () => zoomBy(1 / 1.28),
		setRadial(radial: boolean) {
			radialLayout = radial;
			rebuild();
		},
		destroy() {
			simulation?.stop();
		}
	};
}
