# PT Sontoloyo Monitor — VPS Agent

Lightweight Python (FastAPI) agent that exposes server health to the
**PT Sontoloyo Monitor** dashboard. Author: **Pakde Xresx Digital Store**.

Current contract: **v1.2** (browser probe endpoints + CORS).

## What it reports

`GET /api/status` (header `X-API-Key: <key>`):

```json
{
  "ok": true,
  "uptime": 12345,
  "cpu": 24.1,
  "ram": 41.2,
  "ping": 14,
  "speed": 0.6,
  "rx": 12345678,
  "tx": 87654321,
  "active_users": 27,
  "ssh": true,
  "xray": true,
  "nginx": true,
  "udp": false,
  "total_ssh": 38,
  "total_xray": 0
}
```

Field notes (changed in v1.1+):

- `speed` is **float (1 decimal)** — values <1 Mbps are valid (e.g. `0.4`).
  Previous int-truncation hid every sub-Mbps reading as 0.
- `rx`/`tx` reflect the **current calendar month** on the kernel's
  default-route interface (matches `vnstat -m`). Previously this was
  lifetime cumulative on `interfaces[0]`, which often picked the wrong
  NIC on multi-tunnel hosts.
- `active_users` counts **active subscribers only** — SSH lines in
  `/etc/ssh/.ssh.db` with future expiry plus Xray accounts read from
  the live `config.json`. The legacy `/etc/xray/.userall.db` log file
  is no longer consulted.
- The `online_now` field was removed (no consumer in the dashboard).

Authenticated endpoints (header `X-API-Key`): `/api/status`,
`/api/system`, `/api/traffic`, `/api/online`.

Public endpoints (no auth, CORS-enabled, rate-limited per IP):

- `GET /health` — JSON heartbeat used by the dashboard's
  browser-side **LivePing** component for live RTT measurement.
- `GET /api/probe/download?bytes=N` — streams up to 10 MB of random
  bytes for browser-side **download speedtest**.
- `POST /api/probe/upload` — accepts up to 10 MB of body for
  browser-side **upload speedtest**.

## Install (Debian / Ubuntu)

```bash
# clone or upload this folder to the VPS, then:
sudo SONTOLOYO_API_KEY="$(openssl rand -hex 24)" bash install.sh
```

The installer is **idempotent** — re-run after `git pull` to upgrade
the agent in place. API key is preserved unless you set a new one.

It:

1. Installs `python3-venv`, `iproute2`, `iputils-ping`, `curl`.
2. Copies the agent to `/opt/sontoloyo-agent` and creates a `.venv`.
3. Writes `/etc/sontoloyo-agent.env` with `SONTOLOYO_API_KEY`,
   `SONTOLOYO_HOST`, `SONTOLOYO_PORT`.
4. Installs and starts the `sontoloyo-agent.service` systemd unit.
5. Opens the firewall port via `ufw` (if present).

## Manual test

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: $YOUR_KEY" http://127.0.0.1:8787/api/status

# probe endpoints (public, CORS-allowed)
curl -o /dev/null http://127.0.0.1:8787/api/probe/download?bytes=2000000
curl -X POST --data-binary @1mb.bin http://127.0.0.1:8787/api/probe/upload
```

## Connect to dashboard

In **Admin → Servers → Add Server**, set:

- **VPS Agent base URL** → `https://agent-id1.example.com` (Cloudflare
  Tunnel) or `http://YOUR_VPS_IP:8787` (direct, not recommended for
  production).
- **API Key** → the value from `/etc/sontoloyo-agent.env`.
- **Public Ping Host** → the public Cloudflare-Tunnel hostname (e.g.
  `agent-id1.example.com`). Visitors' browsers will probe this host
  directly for live ping & speedtest. **Do NOT put the real VPS IP
  here** — it would defeat the privacy of the masked `domain` field.

Then click the **Wifi** icon in the row to test, or wait for the next
auto-sync (≤60 s).

## Browser probe configuration

The probe endpoints are designed to be called from a visitor's browser.
Tune via environment variables in `/etc/sontoloyo-agent.env`:

| Var | Default | Purpose |
|---|---|---|
| `SONTOLOYO_CORS_ORIGINS` | `*` | Comma-separated allowlist for CORS. Tighten in production: `https://monitoring.example.com` |
| `SONTOLOYO_PROBE_MAX_BYTES` | `10485760` (10 MB) | Hard cap on download/upload size |
| `SONTOLOYO_PROBE_RATE_LIMIT` | `12` | Max probe calls per `RATE_WINDOW` per IP |
| `SONTOLOYO_PROBE_RATE_WINDOW` | `60` (seconds) | Rate-limit window |

Default lets one visitor with up to 6 server cards on screen do one
download + one upload speedtest each per minute, while blocking
brute-force scrapers.

## Operations

```bash
# logs
journalctl -u sontoloyo-agent -f

# restart
systemctl restart sontoloyo-agent

# rotate key
sed -i "s|^SONTOLOYO_API_KEY=.*|SONTOLOYO_API_KEY=$(openssl rand -hex 24)|" /etc/sontoloyo-agent.env
systemctl restart sontoloyo-agent

# uninstall
sudo bash uninstall.sh
```

## Account totals

`total_ssh` reads `/etc/ssh/.ssh.db` (Indonesian Premium auto-installer
convention) — every line starting with `#ssh#` is counted, expired or
not. Falls back to `/etc/sontoloyo/ssh.users` then to `/etc/passwd`
(uid≥1000, real shell).

`total_xray` reads `/usr/local/etc/xray/config.json` (or
`/etc/xray/config.json`) and counts unique `"email"` values. The
`/etc/xray/.userall.db` log file is **intentionally not consulted** —
it accumulates dateless entries for every account ever created
(including ones already deleted from the panel) and using it as the
ground truth caused a real-world bug where the dashboard reported 41
"ghost" Xray subscribers while the panel correctly showed 0.

## Security

- **Always set** a strong `SONTOLOYO_API_KEY`. The dashboard never
  exposes it to public clients.
- For production, run behind a Cloudflare Tunnel:
  ```bash
  sed -i 's/^SONTOLOYO_HOST=.*/SONTOLOYO_HOST=127.0.0.1/' /etc/sontoloyo-agent.env
  systemctl restart sontoloyo-agent
  ufw delete allow 8787/tcp
  ```
  The agent will only be reachable through the tunnel hostname,
  keeping port 8787 invisible to the internet.
- Tighten `SONTOLOYO_CORS_ORIGINS` to only your dashboard domain in
  production.
