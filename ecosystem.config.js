module.exports = {
	apps: [
		{
			name: 'resource-browser',
			script: 'pnpm',
			args: 'run dev -- --host 0.0.0.0',
			// Ensure this matches where the repo is checked out on the host
			cwd: '/home/noksysadm/work/resource-browser',
			// Leave interpreter unset so PM2 executes the 'pnpm' binary directly
			// interpreter: 'bash',
			env: {
				NODE_ENV: 'development'
			},
			watch: false,
			autorestart: true,
			restart_delay: 5000,
			max_restarts: 10,
			error_file: '/home/noksysadm/work/resource-browser/logs/pm2-error.log',
			out_file: '/home/noksysadm/work/resource-browser/logs/pm2-out.log',
			log_date_format: 'YYYY-MM-DD HH:mm Z'
		}
	]
};
