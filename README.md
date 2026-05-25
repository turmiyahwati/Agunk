# Agunk — Premium VPN/Xray Monitoring Dashboard

Modern, real-time monitoring panel for VPN/Xray VPS fleets. Futuristic dark UI
with neon glassmorphism. Built with **Next.js 14**, **Prisma**, **NextAuth (JWT)**,
**TailwindCSS**, **Framer Motion**, **Recharts**, and a tiny **Python FastAPI agent**
for the VPS side.

> Two roles only: **ADMIN** (full CRUD) and **MEMBER** (view-only).
> No reseller, no auto-create accounts, no config selling — pure monitoring.

---

## Features

- 🟢 Realtime polling of every VPS through a small agent (`/api/status`)
- 🌐 Multi-server, multi-country, multi-provider grid
- 📊 Per-server detail with live charts (Recharts), CPU/RAM/ping/traffic
- 🚦 Auto status: `ONLINE`, `WARNING` (≥90% slot), `FULL`, `OFFLINE`
- 🛡️ Secure: NextAuth (JWT credentials) + role middleware + per-server API key
- 🪟 Glassmorphism, neon glow, animated cards, mobile responsive
- 🛠️ Admin: CRUD servers (name/location/provider/slot/etc), CRUD members, manual sync, test-connection
- 🐧 One-line Debian/Ubuntu installer for the VPS agent

---

## Project structure

```
Agunk/
├─ prisma/
│  ├─ schema.prisma          # User, Server, ServerMetric (SQLite default; switch to postgres easily)
│  └─ seed.ts                # Default admin + demo member + demo servers
├─ scripts/
│  └─ sync-once.ts           # Trigger sync from cron (tsx scripts/sync-once.ts)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                        # Landing
│  │  ├─ login/   register/   post-login # Auth pages
│  │  ├─ dashboard/                      # MEMBER (view-only)
│  │  │   ├─ page.tsx                    # Overview + filter + search
│  │  │   └─ servers/[id]/page.tsx       # Detail w/ live chart
│  │  ├─ admin/                          # ADMIN
│  │  │   ├─ page.tsx                    # Stats + live grid
│  │  │   ├─ servers/page.tsx            # CRUD + test API
│  │  │   ├─ members/page.tsx            # CRUD users
│  │  │   └─ settings/page.tsx
│  │  └─ api/                            # Auth, register, stats, servers, members, monitor sync
│  ├─ components/             # Sidebar, Topbar, ServerCard, StatCard, ui/*
│  ├─ hooks/useServers.ts     # polling for /api/servers/public
│  ├─ lib/                    # prisma, auth, guards, monitor, utils, serialize
│  └─ middleware.ts           # gates /admin (ADMIN) and /dashboard (any user)
├─ vps-agent/                 # ──── runs on each VPN/Xray VPS ────
│  ├─ agunk_agent.py          # FastAPI app exposing /api/status
│  ├─ requirements.txt
│  ├─ install.sh              # one-shot Debian/Ubuntu installer
│  ├─ uninstall.sh
│  ├─ agunk-agent.service     # systemd unit
│  └─ README.md
├─ .env.example
└─ package.json
```

---

## 1) Install (local development)

Prerequisites: **Node.js 20+** and **npm** (or pnpm/yarn).

```bash
git clone https://github.com/<you>/Agunk.git
cd Agunk

cp .env.example .env
# Edit .env — at minimum set NEXTAUTH_SECRET and ADMIN_EMAIL/PASSWORD

npm install
npx prisma generate
npx prisma db push        # creates dev.db (SQLite)
npm run db:seed           # creates default admin + demo data

npm run dev               # http://localhost:3000
```

Default credentials (from `.env`):

| Role   | Email                | Password   |
| ------ | -------------------- | ---------- |
| Admin  | `admin@agunk.local`  | `admin123` |
| Member | `member@agunk.local` | `member123`|

Switch to PostgreSQL: edit `prisma/schema.prisma` provider to `"postgresql"`,
update `DATABASE_URL`, then `npx prisma db push`.

---

## 2) Add a server to monitor

1. Install the agent on the VPS (see section 4).
2. In **Admin → Servers → "Tambah Server"**, fill in:
   - Name, Provider, Country, Domain/IP, Max Slot
   - **VPS Agent base URL** (e.g. `http://1.2.3.4:8787`)
   - **API Key** (the one printed by the installer)
3. Click the **Wifi** icon on that row to test the connection.
4. The dashboard will auto-poll and surface live data to MEMBERs.

---

## 3) Realtime sync

The website re-polls `/api/servers/public` every `NEXT_PUBLIC_REFRESH_MS` ms (default `10000`).
Behind the scenes, that data is refreshed by the **monitor sync** job which contacts each
agent. Run it any of these ways:

**A. Click "Sync now" in the admin Topbar** — triggers `POST /api/monitor/sync` (admin only).

**B. External cron with token** (recommended for prod):

```bash
# /etc/cron.d/agunk-sync — runs every minute
* * * * * root curl -fsS -H "X-Sync-Token: $MONITOR_SYNC_TOKEN" \
  -X POST https://your-domain.com/api/monitor/sync >/dev/null
```

**C. One-shot via tsx** (good for testing): `npm run monitor:sync`.

Auto-status rules (no config required):

| Condition                    | Result    |
| ---------------------------- | --------- |
| agent fetch failed           | OFFLINE   |
| `active >= max`              | FULL      |
| `active / max >= 0.9`        | WARNING   |
| otherwise                    | ONLINE    |

---

## 4) Install the VPS Agent (Debian / Ubuntu)

```bash
# on the VPS:
sudo apt-get update -y
git clone https://github.com/<you>/Agunk.git /tmp/agunk
cd /tmp/agunk/vps-agent

# Generates a strong API key automatically if not provided:
sudo bash install.sh
```

What the installer does:
- creates `/opt/agunk-agent` + Python venv with `fastapi`, `uvicorn`, `psutil`
- writes `/etc/agunk-agent.env` with the API key (chmod 600)
- installs and starts `systemctl status agunk-agent`
- opens UFW port `8787/tcp` if `ufw` is installed

Test:
```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: <key>" http://127.0.0.1:8787/api/status
```

JSON shape returned by `/api/status` (consumed by Agunk):

```json
{
  "ok": true,
  "uptime": 12345, "cpu": 24.1, "ram": 41.2,
  "ping": 14, "speed": 940,
  "rx": 12345678, "tx": 87654321,
  "active_users": 87,
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 120, "total_xray": 80
}
```

The agent auto-restarts via systemd. Logs: `journalctl -u agunk-agent -f`.

For more (rotating keys, firewall, nginx + TLS), see [`vps-agent/README.md`](./vps-agent/README.md).

---

## 5) Deploy the website (production)

### Option A — VPS with PM2 + Nginx

```bash
# on the dashboard VPS:
git clone https://github.com/<you>/Agunk.git
cd Agunk
cp .env.example .env   # set DATABASE_URL=postgresql://..., NEXTAUTH_URL=https://your-domain
npm ci
npm run build           # runs `prisma generate && next build`
npx prisma db push
npm run db:seed         # only the first time

# run with pm2:
npm i -g pm2
pm2 start "npm run start" --name agunk -- -p 3000
pm2 save && pm2 startup
```

Then put nginx in front (reverse proxy 80/443 → 127.0.0.1:3000) and add Let's Encrypt:

```nginx
server {
  server_name your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Option B — Vercel / Railway / Fly

Just push to a Git provider and import. Use **PostgreSQL** (Neon, Supabase, Railway, etc).
Set the same env vars as `.env.example`. No special build step required —
`npm run build` runs `prisma generate && next build`.

---

## 6) Environment variables

See [`.env.example`](./.env.example). Highlights:

| Var                       | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`            | SQLite or Postgres connection string                           |
| `NEXTAUTH_SECRET`         | JWT secret (`openssl rand -base64 32`)                         |
| `NEXTAUTH_URL`            | Public URL of the dashboard                                    |
| `ADMIN_EMAIL/PASSWORD`    | Used by `npm run db:seed` to provision the first admin         |
| `MONITOR_SYNC_TOKEN`      | Allows external cron to call `/api/monitor/sync`               |
| `NEXT_PUBLIC_REFRESH_MS`  | Frontend polling interval                                      |
| `VPS_FETCH_TIMEOUT_MS`    | Per-agent fetch timeout                                        |
| `VPS_FETCH_RETRIES`       | Retry attempts on agent timeout                                |

---

## 7) API endpoints (website)

> All write endpoints require `ADMIN`. Member-safe read = `/api/servers/public`.

| Method | Path                          | Auth              | Notes                              |
| ------ | ----------------------------- | ----------------- | ---------------------------------- |
| POST   | `/api/register`               | public            | Create MEMBER account              |
| GET    | `/api/servers/public`         | any session       | Sanitized list (no api keys)       |
| GET    | `/api/stats`                  | any session       | Aggregate counters                 |
| GET/POST | `/api/servers`              | ADMIN             | List / create                      |
| GET/PATCH/DELETE | `/api/servers/:id`  | ADMIN             | Read / update / delete             |
| POST   | `/api/servers/:id/test`       | ADMIN             | Test agent connection + sync       |
| GET    | `/api/servers/:id/metrics`    | any session       | Recent metrics for chart           |
| GET/POST | `/api/members`              | ADMIN             | List / create user                 |
| PATCH/DELETE | `/api/members/:id`      | ADMIN             | Update / delete user               |
| POST   | `/api/monitor/sync`           | ADMIN or token    | Trigger sync of all enabled agents |

---

## 8) Security checklist

- ✅ Passwords are bcrypt-hashed (`bcryptjs`).
- ✅ Sessions use JWT (NextAuth strategy = `jwt`).
- ✅ Middleware blocks `/admin/**` for non-admin users.
- ✅ The agent API key never leaves the server — it is stored on the dashboard
  and used only by `lib/monitor.ts` server-side.
- ✅ All admin routes validate role via `requireAdmin()`.
- ⚠️ Set strong `NEXTAUTH_SECRET`, `MONITOR_SYNC_TOKEN`, and `AGUNK_API_KEY`.
- ⚠️ Put the agent behind UFW or a private network if possible.

---

## License

MIT — use, modify, and ship freely. Have fun building, fam. ✌️
