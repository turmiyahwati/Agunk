# PT Sontoloyo Monitor — VPS Agent

Lightweight Python (FastAPI) agent that exposes server health to the
**PT Sontoloyo Monitor** dashboard. Author: **Pakde Xresx Digital Store**.

Current contract: **v1.5** (3-tier speed display + 3-window traffic counters).

## What it reports

`GET /api/status` (header `X-API-Key: <key>`):

```json
{
  "ok": true,
  "uptime": 12345,
  "cpu": 24.1, "ram": 41.2,

  "last_test_down_mbps": 845.6,
  "last_test_up_mbps": 812.3,
  "last_test_ping_ms": 14,
  "last_test_at": "2026-05-31T03:00:14Z",
  "rx_speed": 8.2, "tx_speed": 4.2,
  "speed": 12.4,

  "rx": 12345678, "tx": 87654321,
  "rx_today": 5432109, "tx_today": 3210987,
  "rx_boot":  2345678, "tx_boot":  1234567,

  "active_users": 27,
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 38, "total_xray": 0
}
```

### Speed display strategy (2 tiers)

The dashboard renders two honest answers to two different visitor
questions:

| Field | Question | Source | Cost |
|---|---|---|---|
| `last_test_*` | "What's the real-world max?" | Ookla CLI, run daily off-peak | ~6 GB/month per server |
| `rx_speed` / `tx_speed` | "How busy is it now?" | psutil counter delta | Free |

A third "Port Capacity" tier (kernel-reported NIC link speed) was
removed because it returned 0 / 10 Mbps on most LXC/Docker/virtualized
deployments and was misleading visitors more than informing them.

### Traffic counters (3 windows)

| Field | Window | Source | Resets on |
|---|---|---|---|
| `rx` / `tx` | Current calendar month | `vnstat -m` last entry | Month rollover |
| `rx_today` / `tx_today` | Today (calendar day) | `vnstat -d` last entry | Midnight local |
| `rx_boot` / `tx_boot` | Since last reboot | `psutil.net_io_counters()` | VPS reboot |

The dashboard renders `rx_today` / `tx_today` as the prominent
**TODAY** tile next to a `rx_boot` / `tx_boot` "since reboot" tile so
operators see daily-billing numbers alongside the session-level
snapshot Premium installer panels expose in their main menu.

`last_test_*`: Ookla speedtest result, refreshed once per 24 hours by
the agent's internal scheduler at the configured local hour (default
`03:00`). Persisted to `/var/lib/sontoloyo/last_speedtest.json` so it
survives agent restarts. `last_test_at` is `null` until the first
benchmark completes.

`rx_speed` / `tx_speed`: realtime download / upload throughput
(bytes-per-second through the kernel network counter, divided by the
sample interval and converted to Mbps). Idle = ~0, busy = current
data rate. Same number you'd see in the Premium auto-installer's
SPEED line.

`speed`: legacy `rx_speed + tx_speed` combined — kept so v1.2 / v1.3
dashboards keep working unchanged.

### Other fields

- `rx` / `tx`: cumulative bytes for the **current calendar month** on
  the kernel's default-route interface. Matches `vnstat -m`.
- `active_users`: SSH lines in `/etc/ssh/.ssh.db` with future expiry
  + unique Xray emails read from the live `config.json`. The legacy
  `/etc/xray/.userall.db` log file is **not** consulted.

### Endpoints

Authenticated (header `X-API-Key`): `/api/status`, `/api/system`,
`/api/traffic`, `/api/online`.

Public (no auth): `GET /health` — small JSON heartbeat used as a
generic liveness probe by ops scripts and the systemd service test.

## Install (Debian / Ubuntu)

```bash
# clone or upload this folder to the VPS, then:
sudo SONTOLOYO_API_KEY="$(openssl rand -hex 24)" bash install.sh
```

`install.sh` is **idempotent** — re-run after `git pull` to upgrade
the agent in place. The API key is preserved unless you set a new one.

It:

1. Installs `python3-venv`, `iproute2`, `iputils-ping`, `curl`.
2. Adds the Ookla repo and installs the official `speedtest` CLI
   (used for the daily benchmark). If the repo is unreachable the
   install continues without speedtest — the dashboard simply reports
   "Belum diuji" for the tested tier and keeps working.
3. Pre-accepts the Ookla license/GDPR so the scheduler can run
   non-interactively.
4. Creates `/var/lib/sontoloyo` for the speedtest cache file.
5. Copies the agent to `/opt/sontoloyo-agent` and creates a `.venv`.
6. Writes `/etc/sontoloyo-agent.env`.
7. Installs and starts the `sontoloyo-agent.service` systemd unit.
8. Opens the firewall port via `ufw` (if present).

## Manual test

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: $YOUR_KEY" http://127.0.0.1:8787/api/status
```

The first `/api/status` call right after install will return
`last_test_*` as zeros and `last_test_at` as `null` — the initial
benchmark runs in a background thread shortly after agent startup
(~30-60 s). Subsequent calls return the cached result.

## Connect to dashboard

In **Admin → Servers → Add Server**, set:

- **VPS Agent base URL** → `https://agent-id1.example.com` (Cloudflare
  Tunnel) or `http://YOUR_VPS_IP:8787` (direct, not recommended for
  production).
- **API Key** → the value from `/etc/sontoloyo-agent.env`.

Then click the **Wifi** icon in the row to test, or wait for the next
auto-sync (≤60 s).

## Configuration

Tune via environment variables in `/etc/sontoloyo-agent.env`:

| Var | Default | Purpose |
|---|---|---|
| `SONTOLOYO_API_KEY` | (auto-generated) | Bearer token required by `/api/*` endpoints |
| `SONTOLOYO_HOST` | `0.0.0.0` | Bind address. Set to `127.0.0.1` after Cloudflare Tunnel is up. |
| `SONTOLOYO_PORT` | `8787` | TCP port |
| `SONTOLOYO_CACHE_TTL` | `3` | Seconds to memoize `/api/status` (cek-vme, vnstat) |
| `SONTOLOYO_SPEEDTEST_HOUR` | `3` | Local hour-of-day to run the Ookla benchmark (0-23) |
| `SONTOLOYO_SPEEDTEST_INTERVAL` | `24` | Hours between benchmark runs |
| `SONTOLOYO_SPEEDTEST_CACHE` | `/var/lib/sontoloyo/last_speedtest.json` | Persistence path |
| `SONTOLOYO_SPEEDTEST_TIMEOUT` | `300` | Subprocess wallclock cap (seconds) |
| `SONTOLOYO_SPEEDTEST_DISABLE` | (unset) | Set to `1` to skip benchmarking entirely |

## Operations

```bash
# logs
journalctl -u sontoloyo-agent -f

# tail just the speedtest scheduler lines
journalctl -u sontoloyo-agent -f | grep "\[speedtest\]"

# inspect last benchmark
cat /var/lib/sontoloyo/last_speedtest.json

# trigger manual speedtest right now (debug)
speedtest --format=json --accept-license --accept-gdpr

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

## Migration from v1.5

If your dashboard already runs v1.5 of the agent:

1. `git pull` the latest agent code.
2. Re-run `bash install.sh` (idempotent — keeps your existing API key).
3. The new payload drops the `ping` and `link_speed_mbps` fields. Older
   v1.5 dashboards continue to work because they treat missing fields
   as zero — the "Ping (live)" tile and "Port Capacity" tier on those
   builds will simply render as "—".
4. If your dashboard is also upgraded, run `npx prisma db push` on it
   to drop the now-unused `pingMs` / `pingHost` / `linkSpeedMbps`
   columns.

## Migration from v1.4

If your dashboard already runs v1.4 of the agent:

1. `git pull` the latest agent code.
2. Re-run `bash install.sh` (idempotent — keeps your existing API key).
3. The new payload includes `rx_today`, `tx_today`, `rx_boot`,
   `tx_boot` fields. Older v1.4 dashboards continue to work because
   they ignore unknown fields and the existing fields are unchanged.
4. If your dashboard is also upgraded, run `npx prisma db push` on it
   to add the new `rxBytesToday` / `txBytesToday` / `rxBytesBoot` /
   `txBytesBoot` columns. The migration is non-destructive.

## Bandwidth impact

The Ookla CLI transfers ~100-300 MB per benchmark run. With the
default `SONTOLOYO_SPEEDTEST_INTERVAL=24`, that's ~6 GB/month per
server — comfortably under any common VPS bandwidth cap.

To reduce further: `SONTOLOYO_SPEEDTEST_INTERVAL=72` (3 days) cuts
that to ~2 GB/month. To disable entirely: `SONTOLOYO_SPEEDTEST_DISABLE=1`.
