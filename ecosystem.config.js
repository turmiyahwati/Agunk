// PM2 process file for the PT SONTOLOYO Monitor dashboard.
// Developed by PAKDE XRESX DIGITAL STORE.
//
// Usage (on the dashboard VPS, run as root):
//   cd /root/ptsontoloyo-monitor
//   npm ci
//   npm run build
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup
//
// Notes:
//   - Reads runtime env from .env (loaded by Next.js itself).
//   - Listens on PORT (default 3000); nginx reverse-proxies 80/443 -> 3000.
//   - Logs go to ~/.pm2/logs/ptsontoloyo-monitor-* by default.

module.exports = {
  apps: [
    {
      name: "ptsontoloyo-monitor",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // Log paths (PM2 default ~/.pm2/logs/, override here if needed)
      out_file: "/root/.pm2/logs/ptsontoloyo-monitor-out.log",
      error_file: "/root/.pm2/logs/ptsontoloyo-monitor-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
