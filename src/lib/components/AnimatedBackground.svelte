<!-- Professional multi-section diagonal background -->
<div class="fixed inset-0 -z-10 overflow-hidden bg-[#001025]">
	<!-- Dark navy/black bottom left -->
	<div class="bg-section-1 absolute inset-0"></div>

	<!-- Deep blue middle section -->
	<div class="bg-section-2 absolute inset-0"></div>

	<!-- Bright cyan top right -->
	<div class="bg-section-3 absolute inset-0"></div>

	<!-- Purple/violet bottom right -->
	<div class="bg-section-4 absolute inset-0"></div>

	<!-- Smooth gradient overlays -->
	<div class="overlay-gradient absolute inset-0"></div>
</div>

<style>
	/* Dark navy/black bottom left */
	.bg-section-1 {
		background: linear-gradient(to bottom right, #001025, #001d3b, #002b57);
		clip-path: polygon(0 0, 0 100%, 40% 100%, 60% 0);
	}

	/* Deep blue middle section */
	.bg-section-2 {
		background: linear-gradient(135deg, #000d22 0%, #001533 30%, #002044 70%, #003055 100%);
		clip-path: polygon(40% 0, 75% 100%, 50% 100%, 60% 0);
	}

	/* Bright amber top right */
	.bg-section-3 {
		background: linear-gradient(
			225deg,
			#0ef7ff 0%,
			#0bd7ff 20%,
			#07b8ff 50%,
			#0398ff 80%,
			#0078ff 100%
		);
		clip-path: polygon(60% 0, 100% 0, 100% 45%, 75% 100%, 50% 100%);
	}

	/* Dark amber bottom right */
	.bg-section-4 {
		background: linear-gradient(
			45deg,
			#001124 0%,
			#001731 20%,
			#001d3f 40%,
			#002446 60%,
			#002c5a 80%,
			#00306f 100%
		);
		clip-path: polygon(50% 100%, 75% 100%, 100% 45%, 100% 100%);
	}

	/* Smooth gradient overlays for transitions */
	.overlay-gradient {
		background:
			radial-gradient(ellipse at 70% 30%, rgba(14, 247, 255, 0.06) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 70%, rgba(7, 36, 120, 0.06) 0%, transparent 50%),
			radial-gradient(ellipse at 30% 50%, rgba(0, 0, 80, 0.05) 0%, transparent 50%);
		mix-blend-mode: screen;
	}
</style>
