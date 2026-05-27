"""
Agunk VPS Agent — minimal monitoring API for VPN/Xray nodes.

Runs on the VPS (Debian/Ubuntu). Exposes a small HTTP API that the Agunk
website polls. All endpoints (except /health) require an X-API-Key header.

This agent is **read-only**. It never creates, modifies, or deletes VPN
accounts; it only reads metrics from existing system tools (psutil, ss, ps,
vnstat, systemctl) and the standard VPN script databases:

    /etc/ssh/.ssh.db       → SSH/SSL/WS account list
    /etc/xray/.userall.db  → Xray (vmess/vless/trojan) account list
    cek-vme                → optional helper command (active sessions)

It listens on port 8787 by default and is independent from the provisioning
API on port 5888 — they coexist without conflict.

JSON shape returned by /api/status (consumed by Agunk):

{
  "ok": true,
  "uptime": 12345,            # seconds
  "cpu": 24.1,                # percent
  "ram": 41.2,                # percent
  "ping": 14,                 # ms (gateway)
  "speed": 940,               # rough Mb/s (NIC speed)
  "rx": 12345678,             # bytes (today via vnstat, fallback: since-boot)
  "tx": 87654321,             # bytes (today via vnstat, fallback: since-boot)
  "active_users": 87,         # SSH + Xray online sessions
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 120, "total_xray": 80
}
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import time
from typing import Optional, Tuple

import psutil
from fastapi import FastAPI, Header, HTTPException, status

API_KEY = os.environ.get("AGUNK_API_KEY", "change-me")
HOST = os.environ.get("AGUNK_HOST", "0.0.0.0")
PORT = int(os.environ.get("AGUNK_PORT", "8787"))

app = FastAPI(title="Agunk VPS Agent", version="1.1.0")


# ─────────────────────────── helpers ──────────────────────────────────────
def _check_key(key: Optional[str]) -> None:
    if not key or key != API_KEY:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")


def _has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _run(args, timeout: float = 3.0) -> str:
    """Run a command and return stdout (empty string on error)."""
    try:
        out = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=isinstance(args, str),
        )
        return out.stdout or ""
    except Exception:
        return ""


def _service_active(name: str) -> bool:
    out = _run(["systemctl", "is-active", name], timeout=2)
    return out.strip() == "active"


def _udp_active() -> bool:
    # heuristic: any of these UDP services running?
    for n in ("udp-custom", "udp-mini", "badvpn-udpgw", "udp-zivpn", "zivpn"):
        if _service_active(n):
            return True
    return False


def _gateway_ping_ms() -> int:
    try:
        gw = _run("ip route | awk '/default/ {print $3; exit}'", timeout=2).strip()
        if not gw:
            return 0
        out = _run(["ping", "-c", "1", "-W", "1", gw], timeout=3)
        m = re.search(r"time=([\d.]+) ?ms", out)
        return int(float(m.group(1))) if m else 0
    except Exception:
        return 0


def _nic_speed_mbps() -> int:
    try:
        for name, st in psutil.net_if_stats().items():
            if name == "lo" or not st.isup:
                continue
            if st.speed and st.speed > 0:
                return int(st.speed)
    except Exception:
        pass
    return 0


def _net_rx_tx_since_boot() -> Tuple[int, int]:
    n = psutil.net_io_counters()
    return int(n.bytes_recv), int(n.bytes_sent)


def _vnstat_today_rx_tx() -> Optional[Tuple[int, int]]:
    """Today's RX/TX in bytes via `vnstat --json d 1`. None if unavailable."""
    if not _has("vnstat"):
        return None
    try:
        raw = _run(["vnstat", "--json", "d", "1"], timeout=3)
        if not raw.strip():
            return None
        data = json.loads(raw)
        ifaces = data.get("interfaces") or []
        for it in ifaces:
            if it.get("name") == "lo":
                continue
            days = (it.get("traffic") or {}).get("day") or []
            if not days:
                continue
            today = days[-1]
            rx = int(today.get("rx", 0))
            tx = int(today.get("tx", 0))
            # vnstat ≥2 returns bytes already. older versions return KiB; normalise.
            if rx < 1024 and tx < 1024:
                # very small — could still be bytes; leave as-is
                pass
            return rx, tx
        return None
    except Exception:
        return None


def _net_rx_tx() -> Tuple[int, int]:
    """Prefer today's traffic via vnstat; fall back to cumulative since boot."""
    today = _vnstat_today_rx_tx()
    if today is not None:
        return today
    return _net_rx_tx_since_boot()


def _count_lines(text: str) -> int:
    return sum(1 for ln in text.splitlines() if ln.strip())


# ─────────────────────────── account counters ─────────────────────────────
# VPN scripts (autoscript / sshvpn / xray-installer) keep account databases as
# plain-text files where each entry starts with `###` or `#&`. Format examples:
#
#   /etc/ssh/.ssh.db
#       ### Member alice 2026-01-31
#       ### Member bob   2026-02-15
#
#   /etc/xray/.userall.db
#       ### vmess  alice 2026-01-31
#       ### vless  bob   2026-02-15
#       ### trojan eve   2026-03-01
#
# We just count those lines. Comments / blank lines are ignored.
def _count_db_accounts(path: str) -> int:
    if not os.path.isfile(path):
        return 0
    try:
        n = 0
        with open(path, "r", errors="ignore") as fp:
            for ln in fp:
                s = ln.strip()
                if s.startswith("###") or s.startswith("#&"):
                    n += 1
        return n
    except Exception:
        return 0


def _total_ssh_accounts() -> int:
    # 1) Standard VPN-script database
    n = _count_db_accounts("/etc/ssh/.ssh.db")
    if n:
        return n
    # 2) Optional Agunk override
    n = _count_db_accounts("/etc/agunk/ssh.users")
    if n:
        return n
    # 3) Fallback: count regular interactive users (uid>=1000)
    try:
        n = 0
        with open("/etc/passwd") as fp:
            for ln in fp:
                p = ln.strip().split(":")
                if len(p) >= 7 and p[6] not in ("/usr/sbin/nologin", "/bin/false"):
                    try:
                        if int(p[2]) >= 1000 and p[0] != "nobody":
                            n += 1
                    except ValueError:
                        pass
        return n
    except Exception:
        return 0


def _total_xray_accounts() -> int:
    # 1) Standard Xray script database (covers vmess + vless + trojan)
    n = _count_db_accounts("/etc/xray/.userall.db")
    if n:
        return n
    # 2) Optional Agunk override
    n = _count_db_accounts("/etc/agunk/xray.users")
    if n:
        return n
    # 3) Fallback: count "email" entries in xray config.json
    cfg = "/usr/local/etc/xray/config.json"
    if os.path.isfile(cfg):
        try:
            with open(cfg, "r", errors="ignore") as fp:
                return len(re.findall(r'"email"\s*:\s*"', fp.read()))
        except Exception:
            return 0
    return 0


# ─────────────────────────── online counters ──────────────────────────────
def _ssh_online() -> int:
    # users connected via sshd  (e.g. "sshd: alice [priv]@pts/0")
    out = _run("ps -ef | grep -E 'sshd:.*@' | grep -v grep || true", timeout=2)
    return _count_lines(out)


def _xray_online() -> int:
    # established TCP connections to common Xray ports
    out = _run(
        "ss -tn state established "
        "'( sport = :443 or sport = :80 or sport = :8443 or sport = :2083 or sport = :2087 )' "
        "| tail -n +2 || true",
        timeout=2,
    )
    return _count_lines(out)


def _cek_vme_active() -> Optional[int]:
    """If `cek-vme` exists on the VPS, try to read total active sessions from it.

    The output format varies between scripts, so we use a permissive heuristic:
    count lines that look like an active user row (contain 'ON' or a bullet).
    Returns None if the command is missing or output cannot be parsed.
    """
    if not _has("cek-vme"):
        return None
    out = _run(["cek-vme"], timeout=4)
    if not out.strip():
        return None
    n = 0
    for ln in out.splitlines():
        s = ln.strip()
        if not s or s.startswith(("=", "-", "─")):
            continue
        if "ON" in s.split() or "●" in s or "✔" in s or "ACTIVE" in s.upper():
            n += 1
    return n if n > 0 else None


def _active_users_total() -> int:
    """Best-effort active session count: prefer cek-vme, else ss/ps based count."""
    via_cek = _cek_vme_active()
    if via_cek is not None:
        return via_cek
    return _ssh_online() + _xray_online()


# ─────────────────────────── routes ───────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "host": socket.gethostname(), "ts": int(time.time())}


@app.get("/api/status")
def status_endpoint(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    rx, tx = _net_rx_tx()
    return {
        "ok": True,
        "uptime": int(time.time() - psutil.boot_time()),
        "cpu": psutil.cpu_percent(interval=0.2),
        "ram": psutil.virtual_memory().percent,
        "ping": _gateway_ping_ms(),
        "speed": _nic_speed_mbps(),
        "rx": rx, "tx": tx,
        "active_users": _active_users_total(),
        "ssh":   _service_active("ssh") or _service_active("sshd"),
        "xray":  _service_active("xray"),
        "nginx": _service_active("nginx"),
        "udp":   _udp_active(),
        "total_ssh":  _total_ssh_accounts(),
        "total_xray": _total_xray_accounts(),
    }


# Optional granular endpoints (the website uses /api/status by default)
@app.get("/api/system")
def system(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    la = psutil.getloadavg() if hasattr(psutil, "getloadavg") else (0, 0, 0)
    return {
        "host": socket.gethostname(),
        "cpu": psutil.cpu_percent(interval=0.2),
        "ram": psutil.virtual_memory().percent,
        "load": la,
        "uptime": int(time.time() - psutil.boot_time()),
    }


@app.get("/api/traffic")
def traffic(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    rx, tx = _net_rx_tx()
    src = "vnstat" if _vnstat_today_rx_tx() is not None else "psutil"
    return {"rx": rx, "tx": tx, "speed": _nic_speed_mbps(), "source": src}


@app.get("/api/online")
def online(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return {
        "ssh": _ssh_online(),
        "xray": _xray_online(),
        "cek_vme": _cek_vme_active(),
        "active_users": _active_users_total(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
