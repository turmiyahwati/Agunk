# PT Sontoloyo Monitor — VPS Agent

Lightweight Python (FastAPI) agent that exposes server health to the
**PT Sontoloyo Monitor** dashboard. Author: **Pakde Xresx Digital Store**.

Current contract: **v1.3** (split RX/TX throughput).

## What it reports

`GET /api/status` (header `X-API-Key: <key>`):

```json
{
  "ok": true,
  "uptime": 12345,
  "cpu": 24.1,
  "ram": 41.2,
  "ping": 14,
  "speed": 12.4,
  "rx_speed": 8.2,
  "tx_speed": 4.2,
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

Field notes:

- `rx_speed` / `tx_speed` are realtime **network throughput** (bytes
  per second through the kernel network counter, divided by the sample
  interval and converted to Mbps). They reflect the traffic actually
  flowing through the VPS RIGHT NOW — not a periodic speedtest. Idle
  servers report ~0 (correct), busy servers report the current data
  rate. This matches the SPEED line in the Premium auto-installer's
  main menu.
- `speed` is `rx_speed + tx_speed` rounded to 1 decimal — kept for
  backward compatibility with v1.2 dashboards.
- `rx` / `tx` are the cumulative bytes for the **current calendar
  month** on the kernel's default-route interface (matches `vnstat -m`).
- `active_users` counts active subscribers only — SSH lines in
  `/etc/ssh/.ssh.db` with future expiry plus Xray accounts read from
  the live `config.json`. The legacy `/etc/xray/.userall.db` log file
  is NOT consulted.

Authenticated endpoints (header `X-API-Key`): `/api/status`,
`/api/system`, `/api/traffic`, `/api/online`.

Public endpoint (no auth, CORS-enabled): `GET /health` — small JSON
heartbeat used by the dashboard's browser-side **LivePing** component
for realtime latency measurement.

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
```

## Connect to dashboard

In **Admin → Servers → Add Server**, set:

- **VPS Agent base URL** → `https://agent-id1.example.com` (Cloudflare
  Tunnel) or `http://YOUR_VPS_IP:8787` (direct, not recommended for
  production).
- **API Key** → the value from `/etc/sontoloyo-agent.env`.
- **Public Ping Host** → the public Cloudflare-Tunnel hostname (e.g.
  `agent-id1.example.com`). Visitors' browsers will probe this host
  directly for live ping. **Do NOT put the real VPS IP here** — it
  would defeat the privacy of the masked `domain` field.

Then click the **Wifi** icon in the row to test, or wait for the next
auto-sync (≤60 s).

## Configuration

Tune via environment variables in `/etc/sontoloyo-agent.env`:

| Var | Default | Purpose |
|---|---|---|
| `SONTOLOYO_API_KEY` | (auto-generated) | Bearer token required by `/api/*` endpoints |
| `SONTOLOYO_HOST` | `0.0.0.0` | Bind address. Set to `127.0.0.1` after Cloudflare Tunnel is up. |
| `SONTOLOYO_PORT` | `8787` | TCP port |
| `SONTOLOYO_CACHE_TTL` | `3` | Seconds to memoize the heavy probes (cek-vme, vnstat, ping) |
| `SONTOLOYO_CORS_ORIGINS` | `*` | Comma-separated allowlist for `/health` CORS. Tighten in production: `https://monitoring.example.com` |

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

## Migration from v1.2

If your dashboard already runs v1.2 of the agent:

1. `git pull` the latest agent code.
2. Re-run `bash install.sh` (idempotent — keeps your existing API key).
3. The new payload includes `rx_speed` and `tx_speed`. Older
   dashboards that only read `speed` continue to work because the
   agent still sends that field (sum of rx + tx).
4. If your dashboard is also upgraded, run `npx prisma db push` on it
   to add the new `rxSpeedMbps` / `txSpeedMbps` columns. The migration
   is non-destructive.
