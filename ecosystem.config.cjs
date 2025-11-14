module.exports = {
  apps: [
    {
      name: 'resource-browser',
      script: 'npm',
      args: 'run dev -- --host 0.0.0.0',
      cwd: '/home/noksysadm/resource-browser',
  // leave interpreter default for npm wrapper so it runs under node correctly
      env: {
        NODE_ENV: 'development'
      },
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      error_file: '/home/noksysadm/resource-browser/logs/pm2-error.log',
      out_file: '/home/noksysadm/resource-browser/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z'
    }
  ]
}
