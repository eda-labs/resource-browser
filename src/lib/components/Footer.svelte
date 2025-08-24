<script lang="ts">
	export let home: boolean
</script>

<div class="p-5 text-sm flex flex-col space-y-1 text-center items-center justify-center select-none {home ? 'text-gray-400' : 'text-gray-800 dark:text-gray-300 dark:bg-gray-800'}">
	<div>
		Created by
		<a 
			class="hover:underline {home ? 'text-blue-400' : 'text-blue-600 dark:text-blue-500'}"
			href="https://www.linkedin.com/in/siva19susi" target="_blank">Siva Sivakumar
		</a>
		/
		<a
			class="hover:underline {home ? 'text-blue-400' : 'text-blue-600 dark:text-blue-500'}"
			href="https://www.linkedin.com/in/rdodin"
			target="_blank">Roman Dodin
		</a>
	</div>
	<div class="space-x-2">
		<!-- svelte-ignore a11y_consider_explicit_label -->
		<a
			class="hover:underline {home ? 'text-blue-400' : 'text-blue-600 dark:text-blue-500'}"
			href="https://github.com/eda-labs/resource-browser"
			target="_blank">
			<svg
				class="w-5 h-5 {home ? 'text-white hover:text-gray-300' : 'text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300'} inline-flex"
				fill="currentColor"
				viewBox="0 0 25 25"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12.026 2c-5.509 0-9.974 4.465-9.974 9.974 0 4.406 2.857 8.145 6.821 9.465.499.09.679-.217.679-.481 0-.237-.008-.865-.011-1.696-2.775.602-3.361-1.338-3.361-1.338-.452-1.152-1.107-1.459-1.107-1.459-.905-.619.069-.605.069-.605 1.002.07 1.527 1.028 1.527 1.028.89 1.524 2.336 1.084 2.902.829.091-.645.351-1.085.635-1.334-2.214-.251-4.542-1.107-4.542-4.93 0-1.087.389-1.979 1.024-2.675-.101-.253-.446-1.268.099-2.64 0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336 9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021.545 1.372.203 2.387.099 2.64.64.696 1.024 1.587 1.024 2.675 0 3.833-2.33 4.675-4.552 4.922.355.308.675.916.675 1.846 0 1.334-.012 2.41-.012 2.737 0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974 22 6.465 17.535 2 12.026 2z"
				/>
			</svg>
		</a>
		<!-- svelte-ignore a11y_consider_explicit_label -->
		<a
			class="hover:underline {home ? 'text-blue-400' : 'text-blue-600 dark:text-blue-500'}"
			href="https://eda.dev/discord"
			target="_blank">
			<svg class="w-5 h-5 {home ? 'text-white hover:text-gray-300' : 'text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300'} inline-flex" fill="currentColor" viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg">
				<path d="M18.942 5.556a16.3 16.3 0 0 0-4.126-1.3 12.04 12.04 0 0 0-.529 1.1 15.175 15.175 0 0 0-4.573 0 11.586 11.586 0 0 0-.535-1.1 16.274 16.274 0 0 0-4.129 1.3 17.392 17.392 0 0 0-2.868 11.662 15.785 15.785 0 0 0 4.963 2.521c.41-.564.773-1.16 1.084-1.785a10.638 10.638 0 0 1-1.706-.83c.143-.106.283-.217.418-.331a11.664 11.664 0 0 0 10.118 0c.137.114.277.225.418.331-.544.328-1.116.606-1.71.832a12.58 12.58 0 0 0 1.084 1.785 16.46 16.46 0 0 0 5.064-2.595 17.286 17.286 0 0 0-2.973-11.59ZM8.678 14.813a1.94 1.94 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.918 1.918 0 0 1 1.8 2.047 1.929 1.929 0 0 1-1.8 2.045Zm6.644 0a1.94 1.94 0 0 1-1.8-2.045 1.93 1.93 0 0 1 1.8-2.047 1.919 1.919 0 0 1 1.8 2.047 1.93 1.93 0 0 1-1.8 2.045Z"/>
			</svg>
		</a>
	</div>
</div>