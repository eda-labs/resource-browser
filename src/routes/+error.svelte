<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="font-nokia flex h-screen p-7 font-light">
	<div class="m-auto">
		<div class="rounded md:min-w-[400px]">
			<div class="flex items-center rounded-t bg-red-500 px-5 py-3 text-white">
				<a href="/" class="mr-4 flex"><img src="/images/eda.svg" alt="Logo" width="25" /></a>
				<div>
					<p class="text-xs">Resource Browser</p>
					<p>Error {$page.status}</p>
				</div>
			</div>
			<div class="rounded-b bg-red-50 p-5 text-red-500">
				{#if $page.error}
					<p>{$page.error.message}</p>
				{:else}
					<p>Unknown Error</p>
				{/if}
			</div>
		</div>
	</div>
</div>
