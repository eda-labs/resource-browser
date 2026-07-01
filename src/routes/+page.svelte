<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { derived, writable } from 'svelte/store';

	import Footer from '$lib/components/Footer.svelte';

	import { newestApiVersion } from '$lib/apiVersion';
	import type { CrdResource, CrdVersionsMap } from '$lib/structure';

	import yaml from 'js-yaml';
	import res from '$lib/resources.yaml?raw';
	const resources = yaml.load(res) as CrdVersionsMap;
	const crdMeta: CrdResource[] = Object.values(resources).flat();

	const resourceSearch = writable('');

	const resourceSearchFilter = derived(resourceSearch, ($resourceSearch) => {
		const terms = $resourceSearch
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((term) => term.toLowerCase());
		if (terms.length === 0) return crdMeta.map((x) => x.name);

		return crdMeta
			.filter((x) =>
				terms.every(
					(term) =>
						x.kind.toLowerCase().includes(term) ||
						x.group.toLowerCase().includes(term)
				)
			)
			.map((x) => x.name);
	});

	let selectedIndex = crdMeta.length > 0 ? 0 : -1;
	let previousSearch = '';
	let searchInput: HTMLInputElement;
	let resourceList: HTMLDivElement;

	onMount(() => {
		searchInput?.focus();
	});

	$: {
		const search = $resourceSearch;
		const resultCount = $resourceSearchFilter.length;

		if (search !== previousSearch) {
			previousSearch = search;
			selectedIndex = resultCount > 0 ? 0 : -1;
		} else if (resultCount === 0) {
			selectedIndex = -1;
		} else if (selectedIndex < 0) {
			selectedIndex = 0;
		} else if (selectedIndex >= resultCount) {
			selectedIndex = resultCount - 1;
		}
	}

	function getResourceDefinition(resource: string) {
		return crdMeta.find((x) => x.name === resource);
	}

	function getResourceHref(resource: string) {
		const resDef = getResourceDefinition(resource);
		if (!resDef) return '';

		const targetVersion = newestApiVersion(resDef.versions.map((x) => x.name));
		return `${resource}/${targetVersion}`;
	}

	async function focusSelectedResource() {
		await tick();

		resourceList
			?.querySelector<HTMLAnchorElement>(`[data-resource-index="${selectedIndex}"]`)
			?.focus();
	}

	async function scrollSelectedResourceIntoView() {
		await tick();

		resourceList
			?.querySelector<HTMLAnchorElement>(`[data-resource-index="${selectedIndex}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}

	function moveSelection(delta: number, focusSelection = false) {
		const resultCount = $resourceSearchFilter.length;
		if (resultCount === 0) return;

		selectedIndex = (selectedIndex + delta + resultCount) % resultCount;

		if (focusSelection) {
			focusSelectedResource();
		} else {
			scrollSelectedResourceIntoView();
		}
	}

	function openSelectedResource() {
		const selectedResource = $resourceSearchFilter[selectedIndex];
		if (!selectedResource) return;

		window.location.href = getResourceHref(selectedResource);
	}

	function handleResourceKeydown(event: KeyboardEvent) {
		const focusSelection = event.target instanceof HTMLAnchorElement;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveSelection(1, focusSelection);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveSelection(-1, focusSelection);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			openSelectedResource();
		}
	}
</script>

<svelte:head>
	<title>EDA Resource Browser</title>
</svelte:head>

<div class="has-header-img flex min-h-screen flex-col">
	<div class="mx-auto flex grow items-center px-8 py-10 md:px-14">
		<div class="grid grid-cols-1 items-start gap-8 md:gap-20 md:grid-cols-2">
			<div>
				<div class="mt-6 mb-4 flex items-center space-x-4">
					<img src="/images/eda.svg" width="60" alt="Logo" />
					<div>
						<h3 class="text-3xl font-light font-nokia-headline text-yellow-300">Nokia EDA</h3>
						<h4 class="text-2xl font-extralight font-nokia-headline text-gray-300">Resource Browser</h4>
					</div>
				</div>
				<div class="mt-6 max-w-[420px] text-[15px] font-light text-gray-300">
					<p class="mb-3">
						View <a class="underline" href="https://docs.eda.dev">Nokia EDA</a> Custom Resource Definitions
						(CRD) for all applications from Nokia catalog.
					</p>
					<p class="mb-3">
						The resource definitions allow users to easily discover the specification they need to
						provide to the platform in order to manage resources provided by Nokia applications.
					</p>
					<p>The status fields for each resource determine the available status fields for that resource.</p>
				</div>
				<!--<a class="px-2 py-2 rounded-lg text-nowrap text-center text-white bg-gray-600 hover:bg-gray-700" href="/uploads">Uploads</a>-->
			</div>
			<div
				class="max-w-[420px] rounded-lg bg-gray-100 pb-1.5 shadow-xl dark:bg-gray-800"
			>
				<div class="border-b border-gray-300 p-3 dark:border-gray-600">
					<input
						type="text"
						placeholder="Search..."
						bind:this={searchInput}
						bind:value={$resourceSearch}
						on:keydown={handleResourceKeydown}
						aria-controls="resource-list"
						aria-activedescendant={selectedIndex >= 0
							? `resource-option-${selectedIndex}`
							: undefined}
						class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2
              text-[12.5px] text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
					/>
				</div>
				<div class="scroll-thin h-[300px] overflow-y-auto" bind:this={resourceList}>
					<ul id="resource-list">
						{#each $resourceSearchFilter as resource, i}
							{@const resDef = getResourceDefinition(resource)}
							<li
								class="text-gray-900 hover:bg-gray-200 {selectedIndex === i
									? 'bg-gray-200 dark:bg-gray-700'
									: ''} {i > 0
									? 'border-t border-gray-300 dark:border-gray-600'
									: ''} dark:hover:bg-gray-700"
							>
								<a
									id={`resource-option-${i}`}
									data-resource-index={i}
									class="flex flex-col px-4 py-3 focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:ring-inset"
									href={getResourceHref(resource)}
									on:focus={() => (selectedIndex = i)}
									on:keydown={handleResourceKeydown}
								>
									<span class="scroll-thin overflow-x-auto font-nokia-headline dark:text-gray-200"
										>{resDef?.kind}</span
									>
									<span class="font-fira scroll-thin overflow-x-auto text-xs dark:text-gray-200"
										>{resDef?.group}</span
									>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		</div>
	</div>
	<div class="shrink-0">
		<Footer home={true} />
	</div>
</div>
