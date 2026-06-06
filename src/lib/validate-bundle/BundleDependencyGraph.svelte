<script lang="ts">
	import { kindColor } from '$lib/validate-bundle/kindColors';
	import type { BundleGraphEdge, BundleGraphNode } from '$lib/validate-bundle/types';

	export let nodes: BundleGraphNode[] = [];
	export let edges: BundleGraphEdge[] = [];

	$: layout = computeLayout(nodes, edges);

	function computeLayout(
		nodeList: BundleGraphNode[],
		edgeList: BundleGraphEdge[]
	): {
		width: number;
		height: number;
		nodePos: Map<string, { x: number; y: number }>;
		edgePaths: { id: string; d: string; external: boolean }[];
	} {
		const width = 480;
		const height = Math.max(240, nodeList.length * 90 + 40);
		const cx = width / 2;
		const cy = height / 2;
		const radius = Math.min(width, height) * 0.32;
		const nodePos = new Map<string, { x: number; y: number }>();

		nodeList.forEach((node, i) => {
			const angle = (2 * Math.PI * i) / Math.max(nodeList.length, 1) - Math.PI / 2;
			nodePos.set(node.id, {
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle)
			});
		});

		const edgePaths = edgeList.map((edge) => {
			const from = nodePos.get(edge.source);
			const toPos = nodePos.get(edge.target);
			if (!from) return { id: edge.id, d: '', external: edge.external };
			let to = toPos;
			if (!to && edge.external) {
				to = { x: width - 40, y: 30 + (edgeList.indexOf(edge) % 5) * 18 };
			}
			if (!to) return { id: edge.id, d: '', external: edge.external };
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const dist = Math.hypot(dx, dy) || 1;
			const nx = dx / dist;
			const ny = dy / dist;
			const start = { x: from.x + nx * 36, y: from.y + ny * 22 };
			const end = { x: to.x - nx * 36, y: to.y - ny * 22 };
			const mx = (start.x + end.x) / 2 + ny * 24;
			const my = (start.y + end.y) / 2 - nx * 24;
			return {
				id: edge.id,
				d: `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`,
				external: edge.external
			};
		});

		return { width, height, nodePos, edgePaths };
	}
</script>

{#if nodes.length === 0}
	<div class="bundle-graph-empty">
		<p>Validate a bundle to see cross-resource dependencies.</p>
	</div>
{:else}
	<div class="bundle-graph-wrap">
		<svg
			viewBox="0 0 {layout.width} {layout.height}"
			class="bundle-graph-svg"
			role="img"
			aria-label="Dependency graph"
		>
			<defs>
				<marker id="bundle-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="rgb(100 116 139)" />
				</marker>
				<marker id="bundle-arrow-ext" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="rgb(251 191 36)" />
				</marker>
			</defs>

			{#each layout.edgePaths as edge (edge.id)}
				{#if edge.d}
					<path
						d={edge.d}
						fill="none"
						stroke={edge.external ? 'rgb(251 191 36)' : 'rgb(100 116 139)'}
						stroke-width="1.5"
						stroke-dasharray={edge.external ? '4 3' : undefined}
						marker-end={edge.external ? 'url(#bundle-arrow-ext)' : 'url(#bundle-arrow)'}
					/>
				{/if}
			{/each}

			{#each nodes as node (node.id)}
				{@const pos = layout.nodePos.get(node.id)}
				{#if pos}
					<g transform="translate({pos.x}, {pos.y})">
						<rect
							x="-52"
							y="-22"
							width="104"
							height="44"
							rx="8"
							fill={kindColor(node.kind)}
							stroke="rgb(226 232 240 / 0.35)"
							stroke-width="1"
						/>
						<text
							text-anchor="middle"
							y="-4"
							fill="#f8fafc"
							font-size="10"
							font-weight="700"
						>
							{node.kind}
						</text>
						<text text-anchor="middle" y="12" fill="#e2e8f0" font-size="9">{node.name}</text>
					</g>
				{/if}
			{/each}
		</svg>

		<ul class="bundle-graph-legend">
			{#each [...new Set(nodes.map((n) => n.kind))] as kind}
				<li>
					<span class="bundle-graph-swatch" style:background={kindColor(kind)}></span>
					{kind}
				</li>
			{/each}
			<li class="bundle-graph-legend-ext">
				<span class="bundle-graph-swatch bundle-graph-swatch--ext"></span>
				External ref
			</li>
		</ul>
	</div>
{/if}

<style>
	.bundle-graph-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bundle-graph-svg {
		width: 100%;
		min-height: 240px;
		border-radius: 0.5rem;
		background: rgb(15 23 42);
		border: 1px solid rgb(51 65 85);
	}

	.bundle-graph-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 240px;
		border-radius: 0.5rem;
		border: 1px dashed rgb(71 85 105);
		color: rgb(148 163 184);
		font-size: 0.875rem;
	}

	.bundle-graph-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.75rem;
		color: rgb(148 163 184);
	}

	.bundle-graph-swatch {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 9999px;
		margin-right: 0.35rem;
		vertical-align: middle;
	}

	.bundle-graph-swatch--ext {
		background: transparent;
		border: 2px dashed rgb(251 191 36);
	}

	.bundle-graph-legend-ext {
		margin-left: auto;
	}
</style>
