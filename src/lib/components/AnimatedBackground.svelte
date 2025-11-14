<!-- Professional multi-section diagonal background -->
<div class="fixed inset-0 -z-10 overflow-hidden bg-[#000510]">
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
		background: linear-gradient(to bottom right, #000000, #000816, #000d22);
		clip-path: polygon(0 0, 0 100%, 40% 100%, 60% 0);
	}

	/* Deep blue middle section */
	.bg-section-2 {
		background: linear-gradient(135deg, #000d22 0%, #001533 30%, #002044 70%, #003055 100%);
		clip-path: polygon(40% 0, 75% 100%, 50% 100%, 60% 0);
	}

	/* Bright amber top right */
	.bg-section-3 {
		background: linear-gradient(225deg, #ffaa00 0%, #ff8800 20%, #ff6600 50%, #ff4400 80%, #ff2200 100%);
		clip-path: polygon(60% 0, 100% 0, 100% 45%, 75% 100%, 50% 100%);
	}

	/* Dark amber bottom right */
	.bg-section-4 {
		background: linear-gradient(45deg, #220000 0%, #330000 20%, #440000 40%, #550000 60%, #660000 80%, #770000 100%);
		clip-path: polygon(50% 100%, 75% 100%, 100% 45%, 100% 100%);
	}

	/* Smooth gradient overlays for transitions */
	.overlay-gradient {
		background: 
			radial-gradient(ellipse at 70% 30%, rgba(255, 170, 0, 0.08) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 70%, rgba(119, 0, 0, 0.06) 0%, transparent 50%),
			radial-gradient(ellipse at 30% 50%, rgba(68, 0, 0, 0.05) 0%, transparent 50%);
		mix-blend-mode: screen;
	}
</style>
