# PT SONTOLOYO Monitor — Premium VPN/Xray Monitoring Dashboard

> Realtime VPS health dashboard for VPN/Xray operators.
> Built with **Next.js 14 + Prisma + NextAuth + TailwindCSS** (dashboard) and a
> tiny **Python FastAPI agent** (per VPS).
>
> Developed by **PAKDE XRESX DIGITAL STORE**.

> Two roles only: **ADMIN** (full CRUD) and **MEMBER** (view-only).
> No reseller, no auto-create accounts, no config selling — pure monitoring.

---

## Features

- 🟢 Realtime polling of every VPS through a small read-only agent (`/api/status`)
- 🌐 Multi-server, multi-country, multi-provider grid
- 📊 Per-server detail with live charts (Recharts), CPU/RAM/ping/traffic
- 🚦 Auto status: `ONLINE`, `WARNING` (≥90% slot), `FULL`, `OFFLINE`
- 🛡️ Secure: NextAuth (JWT credentials) + role middleware + per-server API key
- 🪟 Glassmorphism, neon glow, animated cards, mobile responsive
- 🛠️ Admin: CRUD servers, CRUD members, manual sync, test connection
- 🐧 One-line Debian/Ubuntu installer for the VPS agent
- 🔒 Public view never exposes real VPS IP/domain (admin-only detail)

---

## Project structure

```
ptsontoloyo-monitor/
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ scripts/
│  └─ sync-once.ts
├─ src/
│  ├─ app/                   # Next.js App Router
│  ├─ components/            # Sidebar, Topbar, ServerCard, ui/*
│  ├─ hooks/useServers.ts    # polling for /api/servers/public
│  ├─ lib/                   # prisma, auth, guards, monitor, utils
│  └─ middleware.ts          # gates /admin and /dashboard
├─ vps-agent/                # ──── runs on each VPN/Xray VPS ────
│  ├─ agunk_agent.py         # FastAPI app exposing /api/status
│  ├─ install.sh             # one-shot Debian/Ubuntu installer (root)
│  ├─ uninstall.sh
│  └─ ptsontoloyo-agent.service
├─ deploy/
│  ├─ DEPLOY.md              # full beginner guide (root-only)
│  ├─ nginx.conf.example     # reverse proxy template
│  └─ ptsontoloyo-sync.cron  # auto-sync template
├─ ecosystem.config.js       # PM2 process file
├─ .env.example
└─ package.json
```

---

## Production deployment (root-only, beginner-friendly)

The full step-by-step guide lives in **[`deploy/DEPLOY.md`](./deploy/DEPLOY.md)**.

Short version:

```bash
# on the dashboard VPS, as root
cd /root
git clone https://github.com/<you>/Agunk.git ptsontoloyo-monitor
cd ptsontoloyo-monitor
cp .env.example .env && nano .env

npm ci
npm run build
npx prisma db push
npm run db:seed

npm i -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

Then nginx reverse-proxies `your-domain.com → 127.0.0.1:3000` (template in `deploy/nginx.conf.example`),
Cloudflare provides DNS + SSL ("Full strict"), and a cron job triggers
realtime sync (template in `deploy/ptsontoloyo-sync.cron`).

---

## VPS agent (per target VPS)

```bash
# on each VPN/Xray VPS, as root
git clone https://github.com/<you>/Agunk.git /tmp/agunk
cd /tmp/agunk/vps-agent
sudo bash install.sh
```

The installer prints an API key — paste it in **Admin → Servers → Add Server**.

Default port: `8787` (provisioning API on `5888` is **never** touched).

Read-only by design — agent never creates/modifies/deletes accounts. See
[`vps-agent/README.md`](./vps-agent/README.md) for data sources & ops.

---

## Realtime sync

Dashboard re-polls `/api/servers/public` every `NEXT_PUBLIC_REFRESH_MS` ms (default `10000`).
Behind the scenes, the **monitor sync** job contacts each agent. Run via:

| Method | When to use |
|---|---|
| Click "Sync now" in admin Topbar | manual ad-hoc |
| External cron with `MONITOR_SYNC_TOKEN` (recommended) | production |
| `npm run monitor:sync` | local testing |

Auto-status rules:

| Condition                    | Result    |
| ---------------------------- | --------- |
| agent fetch failed           | OFFLINE   |
| `active >= max`              | FULL      |
| `active / max >= 0.9`        | WARNING   |
| otherwise                    | ONLINE    |

---

## Environment variables

See [`.env.example`](./.env.example). Highlights:

| Var                       | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`            | SQLite (default) or Postgres connection string         |
| `NEXTAUTH_SECRET`         | JWT secret (`openssl rand -base64 32`)                 |
| `NEXTAUTH_URL`            | Public URL of the dashboard                            |
| `ADMIN_EMAIL/PASSWORD`    | Provisioned by `npm run db:seed` for the first admin   |
| `MONITOR_SYNC_TOKEN`      | Allows external cron to call `/api/monitor/sync`       |
| `NEXT_PUBLIC_REFRESH_MS`  | Frontend polling interval                              |
| `VPS_FETCH_TIMEOUT_MS`    | Per-agent fetch timeout                                |
| `VPS_FETCH_RETRIES`       | Retry attempts on agent timeout                        |

---

## API endpoints

> All write endpoints require `ADMIN`. Public read = `/api/servers/public` (sanitized).

| Method | Path                          | Auth              | Notes                              |
| ------ | ----------------------------- | ----------------- | ---------------------------------- |
| POST   | `/api/register`               | public            | Create MEMBER account              |
| GET    | `/api/servers/public`         | any session       | Sanitized list (no IP/domain/key)  |
| GET    | `/api/stats`                  | any session       | Aggregate counters                 |
| GET/POST | `/api/servers`              | ADMIN             | List / create                      |
| GET/PATCH/DELETE | `/api/servers/:id`  | ADMIN             | Read / update / delete             |
| POST   | `/api/servers/:id/test`       | ADMIN             | Test agent connection + sync       |
| GET    | `/api/servers/:id/metrics`    | any session       | Recent metrics for chart           |
| GET/POST | `/api/members`              | ADMIN             | List / create user                 |
| PATCH/DELETE | `/api/members/:id`      | ADMIN             | Update / delete user               |
| POST   | `/api/monitor/sync`           | ADMIN or token    | Trigger sync of all enabled agents |

---

## Security

- ✅ Passwords are bcrypt-hashed (`bcryptjs`).
- ✅ Sessions use JWT (NextAuth strategy = `jwt`).
- ✅ Middleware blocks `/admin/**` for non-admin users.
- ✅ Per-server agent API key never leaves the dashboard.
- ✅ Public endpoint sanitizes domain/IP/key (admin-only detail).
- ✅ nginx template includes rate limit + brute-force protection on `/api/auth/*`.
- ⚠️ Set strong `NEXTAUTH_SECRET`, `MONITOR_SYNC_TOKEN`, and `MONITOR_API_KEY`.

---

## License

MIT — use, modify, and ship freely.
