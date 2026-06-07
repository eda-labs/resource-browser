<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { highlightYaml, tokenClass } from '$lib/validate-bundle/yamlHighlight';

	export let value = '';
	export let highlightLine: number | null = null;
	export let hasParseError = false;

	let textareaEl: HTMLTextAreaElement | undefined;
	let scrollTop = 0;
	let scrollLeft = 0;

	const dispatch = createEventDispatcher<{ validate: void; format: void }>();

	$: formatLabel = hasParseError ? 'Fix indentation' : 'Format manifests';
	$: formatDisabled = !value.trim();

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
		<span class="yaml-editor-label">YAML bundle</span>
		<div class="yaml-editor-toolbar-actions">
			<button
				type="button"
				class="yaml-toolbar-btn"
				disabled={formatDisabled}
				title="Re-indent YAML to standard CRD layout (2 spaces)"
				on:click={() => dispatch('format')}
			>
				{formatLabel}
			</button>
			<label class="yaml-toolbar-btn yaml-upload-btn">
				<input
					type="file"
					accept=".yaml,.yml,text/yaml"
					class="sr-only"
					on:change={(e) => {
						const file = (e.currentTarget as HTMLInputElement).files?.[0];
						if (!file) return;
						void file.text().then((text) => {
							value = text;
						});
					}}
				/>
				Upload
			</label>
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
				on:keydown={handleKeydown}
				aria-label="YAML bundle input"
			></textarea>
		</div>
	</div>
</div>

<style>
	.yaml-editor-shell {
		display: flex;
		flex-direction: column;
		min-height: 420px;
		border: 1px solid rgb(51 65 85);
		border-radius: 0.75rem;
		overflow: hidden;
		background: rgb(15 23 42);
	}

	.yaml-editor-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid rgb(51 65 85);
		background: rgb(30 41 59 / 0.8);
	}

	.yaml-editor-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: rgb(148 163 184);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.yaml-editor-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.yaml-toolbar-btn {
		cursor: pointer;
		border-radius: 0.375rem;
		border: 1px solid rgb(71 85 105);
		background: rgb(30 41 59);
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: rgb(226 232 240);
	}

	.yaml-toolbar-btn:hover:not(:disabled) {
		background: rgb(51 65 85);
	}

	.yaml-toolbar-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.yaml-upload-btn {
		display: inline-flex;
		align-items: center;
	}

	.yaml-editor-body {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.yaml-gutter {
		flex-shrink: 0;
		width: 3rem;
		padding: 0.75rem 0.5rem;
		border-right: 1px solid rgb(51 65 85);
		background: rgb(15 23 42);
		font-family: ui-monospace, monospace;
		font-size: 0.8125rem;
		line-height: 1.25rem;
		color: rgb(100 116 139);
		text-align: right;
		user-select: none;
	}

	.yaml-gutter-line {
		height: 1.25rem;
	}

	.yaml-gutter-line--highlight {
		color: rgb(250 204 21);
		font-weight: 700;
		background: rgb(234 179 8 / 0.12);
		border-radius: 0.125rem;
	}

	.yaml-editor-stack {
		position: relative;
		flex: 1;
		overflow: hidden;
	}

	.yaml-highlight,
	.yaml-textarea {
		position: absolute;
		inset: 0;
		margin: 0;
		padding: 0.75rem;
		border: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8125rem;
		line-height: 1.25rem;
		tab-size: 2;
		white-space: pre;
		overflow: hidden;
	}

	.yaml-highlight {
		pointer-events: none;
		color: rgb(226 232 240);
	}

	.yaml-textarea {
		resize: none;
		background: transparent;
		color: transparent;
		caret-color: rgb(248 250 252);
		outline: none;
	}

	.yaml-textarea::selection {
		background: rgb(59 130 246 / 0.35);
	}

	:global(.yaml-hl-key) {
		color: rgb(147 197 253);
	}

	:global(.yaml-hl-string) {
		color: rgb(134 239 172);
	}

	:global(.yaml-hl-number) {
		color: rgb(251 191 36);
	}

	:global(.yaml-hl-bool),
	:global(.yaml-hl-null) {
		color: rgb(244 114 182);
	}

	:global(.yaml-hl-comment) {
		color: rgb(100 116 139);
		font-style: italic;
	}

	:global(.yaml-hl-doc) {
		color: rgb(167 139 250);
		font-weight: 600;
	}
</style>
