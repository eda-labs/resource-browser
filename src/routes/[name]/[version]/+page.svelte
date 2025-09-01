<script lang="ts">
	import { page } from '$app/stores';

	import Footer from '$lib/components/Footer.svelte';
	import Navbar from '$lib/components/Navbar.svelte';
	import Render from '$lib/components/Render.svelte';

	import { expandAll, expandAllScope, ulExpanded } from '$lib/store';

	export let data;
	let { name, versionOnFocus, kind, group, deprecated, appVersion, validVersions, spec, status } =
		data;

	const hash = $page.url.hash?.substring(1);

	expandAll.set(false);
	expandAllScope.set('local');
	ulExpanded.set([]);

	function handleGlobalExpand() {
		expandAllScope.set('global');
		if ($ulExpanded.length > 0) {
			expandAll.set(false);
		} else {
			expandAll.set(true);
		}
	}
</script>

<svelte:head>
	<title>EDA Resource Browser | {name} {versionOnFocus}</title>
</svelte:head>
<div class="flex min-h-screen flex-col">
	<Navbar {name} {versionOnFocus} {kind} {group} {deprecated} {appVersion} {validVersions} />
	<main class="flex-1 space-y-4 px-6 pt-[100px] pb-6">
		<div class="flex items-center space-x-2">
			<button
				class="mt-1 cursor-pointer rounded-lg border px-2 py-1 text-xs
        {$ulExpanded.length > 0
					? 'border-gray-300 bg-gray-200 hover:bg-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
					: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600'}"
				on:click={handleGlobalExpand}
			>
				{$ulExpanded.length > 0 ? 'Collapse' : 'Expand'} All
			</button>
		</div>
		<Render {hash} source={'eda'} type={'spec'} data={spec} />
		<div class="my-10"></div>
		<Render {hash} source={'eda'} type={'status'} data={status} />
	</main>

	<Footer home={false} />
</div>
