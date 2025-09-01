<script lang="ts">
	import { derived, writable } from 'svelte/store';

	import Footer from '$lib/components/Footer.svelte';

	import type { CrdVersionsMap } from '$lib/structure';

	import yaml from 'js-yaml';
	import res from '$lib/resources.yaml?raw';
	const resources = yaml.load(res) as CrdVersionsMap;
	const crdMeta = Object.values(resources).flat();

	const crdMetaStore = writable(crdMeta);
	const resourceSearch = writable('');

	const resourceNameStore = derived(crdMetaStore, ($crdMetaStore) =>
		$crdMetaStore.map((x) => x.name)
	);
	const resourceSearchFilter = derived(
		[resourceSearch, resourceNameStore],
		([$resourceSearch, $resourceNameStore]) =>
			$resourceNameStore.filter((x) =>
				$resourceSearch.split(/\s+/).every((y) => x.includes(y.toLowerCase()))
			)
	);
</script>

<svelte:head>
	<title>EDA Resource Browser</title>
</svelte:head>

<div class="has-header-img flex min-h-screen flex-col">
	<div class="mx-auto flex grow items-center px-8 py-10 md:px-14">
		<div class="grid grid-cols-1 items-center gap-5 md:grid-cols-2">
			<div>
				<div class="mt-6 mb-4 flex items-center space-x-4">
					<img src="/images/eda.svg" width="60" alt="Logo" />
					<div>
						<h3 class="text-3xl font-light text-yellow-300">Nokia EDA</h3>
						<h4 class="mt-1 text-2xl font-light text-gray-300">Resource Browser</h4>
					</div>
				</div>
				<div class="mt-2 max-w-[500px] text-sm font-light text-gray-300">
					<p>
						View <a class="underline" href="https://docs.eda.dev">Nokia EDA</a> Custom Resource Definitions
						(CRD) for all applications from Nokia catalog.
					</p>
					<p>
						The resource definitions allow users to easily discover the specification they need to
						provide to the platform in order to manage resources provided by Nokia applications.<br
						/>
						The status fields for each resource determine the available status fields for that resource.
					</p>
				</div>
				<!--<a class="px-2 py-2 rounded-lg text-nowrap text-center text-white bg-gray-600 hover:bg-gray-700" href="/uploads">Uploads</a>-->
			</div>
			<div class="rounded-lg bg-gray-100 pb-1.5 shadow-xl dark:bg-gray-800">
				<div class="border-b border-gray-300 p-3 dark:border-gray-600">
					<input
						type="text"
						placeholder="Search..."
						bind:value={$resourceSearch}
						class="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2
              text-[12.5px] text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400"
					/>
				</div>
				<div class="scroll-thin h-[280px] max-w-[380px] overflow-y-auto lg:w-[380px]">
					<ul>
						{#each $resourceSearchFilter as resource, i}
							{@const resDef = $crdMetaStore.filter((x) => x.name == resource)[0]}
							{@const targetVersion = resDef.versions.map((x) => x.name)[0]}
							<li
								class="text-gray-900 hover:bg-gray-200 {i > 0
									? 'border-t border-gray-300 dark:border-gray-600'
									: ''} dark:hover:bg-gray-700"
							>
								<a class="flex flex-col px-4 py-3" href={`${resource}/${targetVersion}`}>
									<span class="scroll-thin overflow-x-auto text-sm dark:text-gray-200"
										>{resDef.kind}</span
									>
									<span class="font-fira scroll-thin overflow-x-auto text-xs dark:text-gray-200"
										>{resDef.group}</span
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
