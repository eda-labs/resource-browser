<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { highlightYaml, tokenClass } from '$lib/validate-bundle/yamlHighlight';

	export let value = '';
	export let highlightLine: number | null = null;
	export let validating = false;

	let textareaEl: HTMLTextAreaElement | undefined;
	let scrollTop = 0;
	let scrollLeft = 0;

	const dispatch = createEventDispatcher<{ validate: void; input: string }>();

	function handleInput() {
		dispatch('input', value);
	}

	$: lines = value.split('\n');
	$: lineCount = Math.max(lines.length, 1);
	$: tokens = highlightYaml(value);

	export function focusLine(line: number) {
		if (!textareaEl || line < 1) return;
		const lineTexts = value.split('\n');
		let pos = 0;
		for (let i = 0; i < line - 1 && i < lineTexts.length; i++) {
			pos += lineTexts[i].length + 1;
		}
		const lineLen = lineTexts[line - 1]?.length ?? 0;
		textareaEl.focus();
		textareaEl.setSelectionRange(pos, pos + lineLen);
		const lineHeight = 20;
		textareaEl.scrollTop = Math.max(0, (line - 4) * lineHeight);
		scrollTop = textareaEl.scrollTop;
	}

	function handleScroll() {
		if (!textareaEl) return;
		scrollTop = textareaEl.scrollTop;
		scrollLeft = textareaEl.scrollLeft;
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			dispatch('validate');
		}
	}
</script>

<div class="yaml-editor-shell">
	<div class="yaml-editor-toolbar">
		<span class="yaml-editor-label">YAML editor</span>
		<div class="yaml-editor-toolbar-meta">
			{#if validating}
				<span class="yaml-editor-validating" aria-live="polite">
					<svg class="yaml-editor-validating__spinner animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						/>
					</svg>
					Validating…
				</span>
			{/if}
			<span class="yaml-editor-hint">Ctrl+Enter</span>
		</div>
	</div>

	<div class="yaml-editor-body">
		<div class="yaml-gutter" aria-hidden="true" style:transform="translateY({-scrollTop}px)">
			{#each Array(lineCount) as _, i}
				<div
					class="yaml-gutter-line"
					class:yaml-gutter-line--highlight={highlightLine === i + 1}
				>
					{i + 1}
				</div>
			{/each}
		</div>

		<div class="yaml-editor-stack">
			<div
				class="yaml-line-highlights"
				aria-hidden="true"
				style:transform="translate({-scrollLeft}px, {-scrollTop}px)"
			>
				{#each Array(lineCount) as _, i}
					<div
						class="yaml-line-highlight"
						class:yaml-line-highlight--active={highlightLine === i + 1}
					></div>
				{/each}
			</div>

			<pre
				class="yaml-highlight"
				aria-hidden="true"
				style:transform="translate({-scrollLeft}px, {-scrollTop}px)"
			><code>{#each tokens as token}<span class={tokenClass(token.type)}>{token.text}</span>{/each}</code></pre>

			<textarea
				bind:this={textareaEl}
				bind:value
				class="yaml-textarea"
				spellcheck="false"
				autocapitalize="off"
				autocomplete="off"
				autocorrect="off"
				on:scroll={handleScroll}
				on:input={handleInput}
				on:keydown={handleKeydown}
				aria-label="YAML input"
			></textarea>
		</div>
	</div>
</div>
