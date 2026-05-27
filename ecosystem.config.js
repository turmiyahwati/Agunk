// PM2 process file for the Agunk dashboard.
// Usage (on the dashboard VPS):
//   npm ci
//   npm run build
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup
//
// Notes:
//   - Reads runtime env from .env (loaded by Next.js itself).
//   - Listens on PORT (default 3000); nginx reverse-proxies 80/443 → 3000.
//   - Logs go to ~/.pm2/logs/agunk-* by default.

module.exports = {
  apps: [
    {
      name: "agunk",
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
    },
  ],
};
