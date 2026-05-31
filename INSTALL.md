# Quick Install — PT Sontoloyo Monitor

> 1-command auto-installer for fresh Ubuntu 24.04 LTS.
> Cloudflare-related steps stay manual on purpose, with clear pause-points.

---

## TL;DR

**On a fresh Ubuntu 24.04 VPS:**

```bash
curl -fsSL https://raw.githubusercontent.com/turmiyahwati/Agunk/main/scripts/install-dashboard.sh \
  | sudo bash
```

The installer runs 10 steps. It pauses at step 7 to let you complete Cloudflare DNS + SSL manually, then resumes automatically.

**Total time:** ~5 minutes interactive + ~2 minutes building.

---

## What the installer does

| Step | What happens | Manual / Auto |
|---|---|---|
| 1 | apt update + ufw + timezone Asia/Jakarta | Auto |
| 2 | Node 20 + PM2 + nginx install | Auto |
| 3 | Clone the repo to `/root/sontoloyo-monitor` | Auto |
| 4 | Wizard: ask for domain + admin email; generate strong secrets and write `.env` | Interactive |
| 5 | `npm ci`, Prisma generate + push, db:seed, `npm run build` | Auto |
| 6 | PM2 start + systemd autostart | Auto |
| 7 | **PAUSE** — you do Cloudflare DNS A record + Origin Certificate, paste cert/key | **Manual (with clear instructions)** |
| 8 | Render nginx config from template, `nginx -t`, reload | Auto |
| 9 | Cron auto-sync (every minute) + nightly encrypted backup at 02:30 | Auto |
| 10 | Smoke test (curl localhost:3000, curl HTTPS, pm2 status) | Auto |

At the end you get:

- Dashboard online at `https://<your-domain>`
- Admin credentials saved to `/root/sontoloyo-credentials.txt` (mode 600)
- Backup cron writing to `/root/sontoloyo-backups/` daily
- Sync cron logging to `/var/log/sontoloyo-sync.log`

---

## Prerequisites (before you run it)

- ✅ Ubuntu 24.04 LTS VPS, root SSH
- ✅ Domain registered + on Cloudflare (free plan ok)
- ✅ Subdomain decided in advance, e.g. `monitoring.your-domain.com`
- ✅ ~5 minutes of attention for the Cloudflare manual step

---

## Non-interactive (CI / re-deploy)

Set every prompt as an env var:

```bash
sudo SONTOLOYO_DOMAIN=monitoring.example.com \
     SONTOLOYO_ADMIN_EMAIL=admin@example.com \
     SONTOLOYO_ADMIN_PASSWORD='strong-password-here' \
     SONTOLOYO_NON_INTERACTIVE=1 \
     bash scripts/install-dashboard.sh
```

In non-interactive mode you must place `/etc/ssl/cloudflare/origin.{pem,key}` BEFORE running, otherwise step 7 will abort.

---

## Re-running the installer

The installer is idempotent. Each completed step writes a marker to `/var/lib/sontoloyo-install/`. Re-running picks up where you left off.

Reset and re-run from scratch:

```bash
sudo bash scripts/install-dashboard.sh --reset
```

---

## Cloudflare manual steps (the only thing not automated)

When the installer reaches step 7, it pauses and prints these instructions. You can do them in advance to make the pause shorter:

### A. DNS record
- Cloudflare → DNS → Records → **+ Add record**
- Type: A, Name: `monitoring`, IPv4: your VPS public IP, Proxy: **Proxied (orange cloud)**

### B. SSL/TLS mode
- Cloudflare → SSL/TLS → Overview → **Full (strict)**
- SSL/TLS → Edge Certificates → enable: Always Use HTTPS, Auto HTTPS Rewrites, Min TLS 1.2

### C. Origin Certificate (15-year, free)
- Cloudflare → SSL/TLS → Origin Server → **Create Certificate**
- Defaults are fine (RSA 2048, *.your-domain + your-domain, 15 years)
- ⚠️ **Copy BOTH the certificate AND the private key** — Cloudflare shows the private key only once

The installer will then prompt:
1. Paste the certificate block (`-----BEGIN CERTIFICATE-----…`) → end with blank line + Ctrl-D
2. Paste the private key block (`-----BEGIN PRIVATE KEY-----…`) → end with blank line + Ctrl-D

### D. (Optional, do anytime) Cloudflare hardening
After the installer finishes, in Cloudflare dashboard:

- Security → WAF → Managed Rules: **ON**
- Security → Bots → Bot Fight Mode: **ON**
- Speed → Optimization → **Brotli + Auto Minify (HTML/CSS/JS)**: ON
- Network → **HTTP/3 (QUIC)**: ON
- Page Rule: `monitoring.your-domain/api/*` → **Cache Level: Bypass**

⚠️ **DO NOT enable** Rocket Loader or Email Obfuscation — they break Next.js hydration.

---

## Adding agent VPSes

For each VPS you want to monitor:

1. SSH into the VPS:
   ```bash
   ssh root@AGENT_VPS_IP
   ```

2. Run the agent installer:
   ```bash
   git clone https://github.com/turmiyahwati/Agunk.git /tmp/sontoloyo
   cd /tmp/sontoloyo/vps-agent
   bash install.sh
   ```

3. **Note the API key** printed at the end.

4. Set up Cloudflare Tunnel (manual — guide auto-printed at the end of `install.sh`).

5. In dashboard Admin → Servers → **+ Tambah Server**, fill in:
   - VPS Agent base URL: `https://agent-<id>.your-domain.com`
   - API Key: (from step 3)
   - Click Wifi icon to test → "Agent reachable · synced" ✅

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Run as root` | Prefix with `sudo` |
| Step 7 aborts because cert/key looks wrong | Re-run installer, paste again. Cert must start `-----BEGIN CERTIFICATE-----`, key must start `-----BEGIN PRIVATE KEY-----` |
| `nginx -t` fails after step 8 | Check `/etc/nginx/sites-available/sontoloyo`, fix manually, then re-run installer (it will pick up at step 9) |
| Dashboard returns 502 after install | `pm2 logs sontoloyo` — usually missing env var; edit `.env` and `pm2 reload sontoloyo` |
| Cron sync gets HTTP 401 | `MONITOR_SYNC_TOKEN` in `.env` and `/etc/cron.d/sontoloyo` are out of sync — re-run installer with `--reset` of step 9 only: `rm /var/lib/sontoloyo-install/09_cron.done && sudo bash scripts/install-dashboard.sh` |

---

## Backup & disaster recovery

The installer schedules a nightly encrypted backup to `/root/sontoloyo-backups/`. To enable encryption, set this in `.env`:

```env
SONTOLOYO_BACKUP_PASSPHRASE="<some-strong-passphrase-store-it-elsewhere>"
```

Manual backup:
```bash
sudo bash scripts/backup-all.sh
```

To restore on a fresh VPS, see [`RECOVERY.md`](./RECOVERY.md).

---

## What the installer does NOT do

- ✗ Does **NOT** touch your Cloudflare account API (manual on purpose for safety)
- ✗ Does **NOT** install on agent VPSes (separate `vps-agent/install.sh`)
- ✗ Does **NOT** set up Cloudflare Tunnel (manual on agent side; instructions auto-printed)
- ✗ Does **NOT** configure your VPN/Xray autoscript — the dashboard is read-only against operator state

---

For the full step-by-step manual guide (without the installer), see [`DEPLOY.md`](./DEPLOY.md).
