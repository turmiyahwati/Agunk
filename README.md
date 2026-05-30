# PT Sontoloyo Monitor

> Premium realtime VPN/Xray server monitoring dashboard.
> **Author / Developer:** Pakde Xresx Digital Store.

A modern, public-by-default monitoring panel with futuristic neon glassmorphism UI.
Visitors see realtime server status without login. Only the **admin** logs in to manage
servers and sync data from the lightweight Python agent that runs on each VPS.

**Stack:** Next.js 14 · Prisma · NextAuth (JWT) · TailwindCSS · Framer Motion · Recharts · FastAPI agent.

> Single-role: only **ADMIN**. No member registration. No reseller. Just monitoring.

---

## Features

- 🌐 Public realtime monitoring at `/` — no login required
- 📈 Per-server detail with live charts (CPU, RAM, ping, traffic, slot)
- 🚦 Auto status: `ONLINE`, `WARNING` (≥90% slot), `FULL`, `OFFLINE`
- 🛠️ Admin: CRUD servers, manual sync, test agent connection
- 🔐 NextAuth credentials with anti-bruteforce + secure headers + sanitized responses
- 🪟 Glassmorphism, neon glow, animated counters — fully mobile responsive
- 🐧 One-line Debian/Ubuntu installer for the VPS agent

---

## Project structure

```
sontoloyo-monitor/
├─ prisma/
│  ├─ schema.prisma          # User (admin only), Server, ServerMetric
│  └─ seed.ts                # Default admin + demo servers
├─ scripts/
│  └─ sync-once.ts           # Trigger sync from cron (tsx scripts/sync-once.ts)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                        # Public monitoring (homepage)
│  │  ├─ servers/[id]/page.tsx           # Public server detail
│  │  ├─ login/page.tsx                  # Admin login
│  │  ├─ admin/                          # ADMIN
│  │  │   ├─ page.tsx                    # Stats + live grid
│  │  │   ├─ servers/page.tsx            # CRUD + test API
│  │  │   └─ settings/page.tsx
│  │  └─ api/                            # Auth, stats, servers, monitor sync
│  ├─ components/             # PublicHeader, ContactBar, WelcomeBanner,
│  │                          # Sidebar, Topbar, ServerCard, StatCard,
│  │                          # AnimatedNumber, ui/*
│  ├─ hooks/useServers.ts     # polling for /api/servers/public
│  ├─ lib/                    # prisma, auth, guards, monitor, utils,
│  │                          # serialize, sanitize, rate-limit, api-error
│  └─ middleware.ts           # gates only /admin/*
├─ vps-agent/                 # ──── runs on each VPN/Xray VPS ────
│  ├─ sontoloyo_agent.py      # FastAPI app exposing /api/status
│  ├─ requirements.txt
│  ├─ install.sh              # one-shot Debian/Ubuntu installer
│  ├─ uninstall.sh
│  ├─ sontoloyo-agent.service # systemd unit
│  └─ README.md
├─ .env.example
└─ package.json
```

---

## 1) Local development

Prerequisites: **Node.js 20+** and **npm** (or pnpm/yarn).

```bash
git clone <your-repo-url>.git sontoloyo-monitor
cd sontoloyo-monitor

cp .env.example .env
# Edit .env — at minimum set NEXTAUTH_SECRET and ADMIN_EMAIL/PASSWORD
# Optional: NEXT_PUBLIC_WHATSAPP_NUMBER for the contact button

npm install
npx prisma generate
npx prisma db push        # creates dev.db (SQLite)
npm run db:seed           # creates the default admin + demo data

npm run dev               # http://localhost:3000
```

Default admin (from `.env`):

| Email                    | Password   |
| ------------------------ | ---------- |
| `admin@sontoloyo.local`  | `admin123` |

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
4. The dashboard will auto-poll and surface live data on the public homepage.

---

## 3) Realtime sync

The dashboard re-polls `/api/servers/public` every `NEXT_PUBLIC_REFRESH_MS` ms (default `10000`).
Behind the scenes, that data is refreshed by the **monitor sync** job which contacts each agent.
Run it any of these ways:

**A. Click "Sync now" in the admin Topbar** — triggers `POST /api/monitor/sync` (admin only).

**B. External cron with token** (recommended for prod):

```bash
# /etc/cron.d/sontoloyo-sync — runs every minute
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
git clone <your-repo-url>.git /tmp/sontoloyo
cd /tmp/sontoloyo/vps-agent

# Generates a strong API key automatically if not provided:
sudo bash install.sh
```

What the installer does:
- creates `/opt/sontoloyo-agent` + Python venv with `fastapi`, `uvicorn`, `psutil`
- writes `/etc/sontoloyo-agent.env` with the API key (chmod 600)
- installs and starts `systemctl status sontoloyo-agent`
- opens UFW port `8787/tcp` if `ufw` is installed

Test:
```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: <key>" http://127.0.0.1:8787/api/status
```

JSON shape returned by `/api/status` (v1.3 contract):

```json
{
  "ok": true,
  "uptime": 12345, "cpu": 24.1, "ram": 41.2,
  "ping": 14,
  "speed": 12.4, "rx_speed": 8.2, "tx_speed": 4.2,
  "rx": 12345678, "tx": 87654321,
  "active_users": 27,
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 38, "total_xray": 0
}
```

`rx_speed` and `tx_speed` are realtime network throughput (RX/TX byte
delta per second). They reflect the traffic actually flowing through
the VPS, NOT a periodic speedtest. Idle servers report ~0; busy
servers report the current rate. The combined `speed` field is kept
for backward compatibility.

`rx`/`tx` reflect the current calendar month on the kernel default-route
interface (matches `vnstat -m`). `active_users` counts active subscribers
(SSH lines with future expiry + unique Xray emails in `config.json`).

Public endpoint (no auth, CORS-enabled): `GET /health` — small JSON
heartbeat used by the dashboard's browser-side LivePing component for
realtime latency measurement.

The agent auto-restarts via systemd. Logs: `journalctl -u sontoloyo-agent -f`.

For more (rotating keys, firewall, nginx + TLS), see [`vps-agent/README.md`](./vps-agent/README.md).

---

## 5) Deploy the dashboard (production)

### Option A — VPS with PM2 + Nginx

```bash
# on the dashboard VPS:
git clone <your-repo-url>.git
cd sontoloyo-monitor
cp .env.example .env   # set DATABASE_URL=postgresql://..., NEXTAUTH_URL=https://your-domain
npm ci
npm run build           # runs `prisma generate && next build`
npx prisma db push
npm run db:seed         # only the first time

# run with pm2:
npm i -g pm2
pm2 start "npm run start" --name sontoloyo -- -p 3000
pm2 save && pm2 startup
```

Nginx reverse proxy:

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

### Option C — Hosting panel (cPanel, Plesk, aaPanel)

1. Upload the repo to your home directory.
2. Open the panel's Node.js app manager and create a new app pointing to the project root.
3. Set **start command**: `npm run start`, **dev script**: `npm run build`.
4. Add env vars from `.env.example`.
5. Run `npm install`, then `npx prisma generate && npx prisma db push && npm run db:seed`.
6. Reverse-proxy your domain to the app's port.

---

## 6) Environment variables

See [`.env.example`](./.env.example). Highlights:

| Var                              | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                   | SQLite or Postgres connection string                          |
| `NEXTAUTH_SECRET`                | JWT secret (`openssl rand -base64 32`)                        |
| `NEXTAUTH_URL`                   | Public URL of the dashboard                                   |
| `ADMIN_EMAIL/PASSWORD`           | Used by `npm run db:seed` to provision the first admin        |
| `MONITOR_SYNC_TOKEN`             | Allows external cron to call `/api/monitor/sync`              |
| `NEXT_PUBLIC_REFRESH_MS`         | Frontend polling interval                                     |
| `VPS_FETCH_TIMEOUT_MS`           | Per-agent fetch timeout                                       |
| `VPS_FETCH_RETRIES`              | Retry attempts on agent timeout                               |
| `NEXT_PUBLIC_BRAND_NAME`         | Brand name shown in header / metadata                         |
| `NEXT_PUBLIC_BRAND_SUFFIX`       | Brand suffix (e.g. "Monitor")                                 |
| `NEXT_PUBLIC_AUTHOR`             | Author shown in footer                                        |
| `NEXT_PUBLIC_WHATSAPP_NUMBER`    | International format (e.g. 6281234567890). Empty → hide btn   |
| `NEXT_PUBLIC_WHATSAPP_TEXT`      | Pre-filled WhatsApp message                                   |

---

## 7) API endpoints

> Public endpoints are open. Admin endpoints require a NextAuth session.

| Method | Path                          | Auth              | Notes                              |
| ------ | ----------------------------- | ----------------- | ---------------------------------- |
| GET    | `/api/servers/public`         | **public**        | Sanitized list (no api keys)       |
| GET    | `/api/stats`                  | **public**        | Aggregate counters                 |
| GET    | `/api/servers/:id/metrics`    | **public**        | Recent metrics (chart)             |
| GET/POST | `/api/servers`              | ADMIN             | List / create                      |
| GET/PATCH/DELETE | `/api/servers/:id`  | ADMIN             | Read / update / delete             |
| POST   | `/api/servers/:id/test`       | ADMIN             | Test agent connection + sync       |
| POST   | `/api/monitor/sync`           | ADMIN or token    | Trigger sync of all enabled agents |

---

## 8) Security checklist

- ✅ Single-role architecture — only `ADMIN` accounts in the DB.
- ✅ Public monitoring uses Prisma `select` whitelists (no `apiKey`/`apiUrl`/`lastError` ever sent).
- ✅ Private/internal IPs in `domain` are masked via `lib/sanitize.ts`.
- ✅ NextAuth (JWT) with anti-bruteforce: 5 failed attempts per email per 60s.
- ✅ Middleware blocks `/admin/**` for non-authenticated users.
- ✅ Secure HTTP headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP).
- ✅ `safeErrorMessage()` prevents stack-trace / Prisma error leaks.
- ⚠️ **Always set** strong `NEXTAUTH_SECRET`, `MONITOR_SYNC_TOKEN`, and `SONTOLOYO_API_KEY`.
- ⚠️ Put each VPS agent behind UFW or a private network when possible.

---

## License

MIT — © Pakde Xresx Digital Store.
