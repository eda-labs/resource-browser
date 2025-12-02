module.exports = {
	apps: [
		{
			name: 'resource-browser',
			// use pnpm if pnpm is installed; fallback to npm would be explicit
			script: 'pnpm',
			args: 'run dev -- --host 0.0.0.0',
			// Do not specify an interpreter; allow PM2 to execute `pnpm` directly
			// interpreter: 'bash',
			env: {
				NODE_ENV: 'development'
			},
			watch: false,
			autorestart: true,
			restart_delay: 5000,
			max_restarts: 10,
			error_file: './logs/pm2-error.log',
			out_file: './logs/pm2-out.log',
			log_date_format: 'YYYY-MM-DD HH:mm Z'
		}
	]
};
