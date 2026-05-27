# Agunk VPS Agent

Lightweight Python (FastAPI) agent that exposes server health to the Agunk website.

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
sudo AGUNK_API_KEY="$(openssl rand -hex 24)" bash install.sh
```

The installer:

1. Installs `python3-venv`, `iproute2`, `iputils-ping`, `curl`.
2. Copies the agent to `/opt/agunk-agent` and creates a `.venv`.
3. Writes `/etc/agunk-agent.env` with `AGUNK_API_KEY`, `AGUNK_HOST`, `AGUNK_PORT`.
4. Installs and starts the `agunk-agent.service` systemd unit.
5. Opens the firewall port via `ufw` (if present).

## Manual test

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: $YOUR_KEY" http://127.0.0.1:8787/api/status
```

## Connect to Agunk dashboard

In **Admin → Servers → Add Server**, set:

- **VPS Agent base URL** → `http://YOUR_VPS_IP:8787`
- **API Key** → the value from `/etc/agunk-agent.env`

Then click the **Wifi** icon in the row to test, or wait for the next sync.

## Operations

```bash
# logs
journalctl -u agunk-agent -f

# restart
systemctl restart agunk-agent

# rotate key
sed -i "s|^AGUNK_API_KEY=.*|AGUNK_API_KEY=$(openssl rand -hex 24)|" /etc/agunk-agent.env
systemctl restart agunk-agent

# uninstall
sudo bash uninstall.sh
```

## Data sources

The agent is **read-only**. It never creates / modifies / deletes accounts —
it only reads from the standard tools your VPN script already maintains:

| Metric                | Source                                                    |
| --------------------- | --------------------------------------------------------- |
| `cpu`, `ram`, `uptime`| `psutil`                                                  |
| `ssh`/`xray`/`nginx`/`udp` | `systemctl is-active <name>`                         |
| `ping`                | `ping` to default gateway                                 |
| `speed`               | NIC link speed via `psutil.net_if_stats()`                |
| `rx` / `tx`           | `vnstat --json d 1` (today). Falls back to psutil since-boot if `vnstat` is not installed. |
| `total_ssh`           | `/etc/ssh/.ssh.db` → `/etc/agunk/ssh.users` → `/etc/passwd` (uid≥1000) |
| `total_xray`          | `/etc/xray/.userall.db` → `/etc/agunk/xray.users` → `"email"` entries in `/usr/local/etc/xray/config.json` |
| `active_users`        | `cek-vme` if available, else `ps`/`ss` heuristic          |

The `.ssh.db` / `.userall.db` files are the de-facto convention used by the
common VPN install scripts; each account is one line starting with `###`
(or `#&`). The agent simply counts those lines.

> **Port note**: agent defaults to **8787**. Your provisioning API on
> **5888** is untouched — they run side by side.

## Security

- **Always set** a strong `AGUNK_API_KEY`. The website never exposes it to clients.
- Bind to a private interface or restrict via `ufw` if you can:
  ```bash
  ufw allow from <agunk-website-ip> to any port 8787 proto tcp
  ufw deny 8787/tcp
  ```
- Put it behind nginx + TLS for production:
  ```
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
  }
  ```
