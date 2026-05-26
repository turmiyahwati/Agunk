# PT Sontoloyo Monitor — VPS Agent

Lightweight Python (FastAPI) agent that exposes server health to the
**PT Sontoloyo Monitor** dashboard. Author: **Pakde Xresx Digital Store**.

## What it reports

`GET /api/status` (header `X-API-Key: <key>`):

```json
{
  "ok": true,
  "uptime": 12345,
  "cpu": 24.1,
  "ram": 41.2,
  "ping": 14,
  "speed": 940,
  "rx": 12345678,
  "tx": 87654321,
  "active_users": 87,
  "ssh": true,
  "xray": true,
  "nginx": true,
  "udp": false,
  "total_ssh": 120,
  "total_xray": 80
}
```

Other endpoints (also key-protected): `/api/system`, `/api/traffic`, `/api/online`.
Public: `/health` (no auth) — useful for uptime checks.

## Install (Debian / Ubuntu)

```bash
# upload this folder to the VPS, then:
sudo SONTOLOYO_API_KEY="$(openssl rand -hex 24)" bash install.sh
```

The installer:

1. Installs `python3-venv`, `iproute2`, `iputils-ping`, `curl`.
2. Copies the agent to `/opt/sontoloyo-agent` and creates a `.venv`.
3. Writes `/etc/sontoloyo-agent.env` with `SONTOLOYO_API_KEY`, `SONTOLOYO_HOST`, `SONTOLOYO_PORT`.
4. Installs and starts the `sontoloyo-agent.service` systemd unit.
5. Opens the firewall port via `ufw` (if present).

## Manual test

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: $YOUR_KEY" http://127.0.0.1:8787/api/status
```

## Connect to dashboard

In **Admin → Servers → Add Server**, set:

- **VPS Agent base URL** → `http://YOUR_VPS_IP:8787`
- **API Key** → the value from `/etc/sontoloyo-agent.env`

Then click the **Wifi** icon in the row to test, or wait for the next sync.

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

## Account totals (optional)

For accurate `total_ssh` and `total_xray`, drop one user per line in:

- `/etc/sontoloyo/ssh.users`
- `/etc/sontoloyo/xray.users`

If those files are missing, the agent falls back to:
- SSH: count of `/etc/passwd` users with `uid>=1000` and a real shell.
- Xray: count of `"email"` entries in `/usr/local/etc/xray/config.json`.

## Security

- **Always set** a strong `SONTOLOYO_API_KEY`. The dashboard never exposes it to clients.
- Bind to a private interface or restrict via `ufw` if you can:
  ```bash
  ufw allow from <dashboard-ip> to any port 8787 proto tcp
  ufw deny 8787/tcp
  ```
- Put it behind nginx + TLS for production:
  ```
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
  }
  ```
