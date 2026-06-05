<script lang="ts">
	export let activeStep: 1 | 2 | 3 = 1;

	const steps = [
		{ num: 1, title: 'Pick releases', desc: 'Source baseline & target' },
		{ num: 2, title: 'Compare', desc: 'Generate schema diff' },
		{ num: 3, title: 'Explore diffs', desc: 'Filter, search & export' }
	] as const;
</script>

<section class="comparison-hero" aria-labelledby="comparison-heading">
	<div class="comparison-hero__content">
		<p class="homepage-hero-kicker">Release comparison</p>
		<h1 id="comparison-heading" class="homepage-title text-slate-900 dark:text-slate-100">
			Compare EDA releases
		</h1>
		<p class="homepage-subtitle text-slate-600 dark:text-slate-400">
			Analyze CRD schema changes between two releases — added, removed, and modified spec and status
			fields with exportable reports.
		</p>
	</div>

	<ol class="comparison-workflow" aria-label="Comparison workflow">
		{#each steps as step}
			<li
				class="comparison-workflow-step"
				class:comparison-workflow-step--active={activeStep === step.num}
				class:comparison-workflow-step--done={activeStep > step.num}
			>
				<span class="comparison-workflow-step__num" aria-hidden="true">{step.num}</span>
				<span class="comparison-workflow-step__text">
					<span class="comparison-workflow-step__title">{step.title}</span>
					<span class="comparison-workflow-step__desc">{step.desc}</span>
				</span>
			</li>
		{/each}
	</ol>
</section>
