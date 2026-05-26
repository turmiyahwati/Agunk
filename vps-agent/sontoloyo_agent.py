"""
PT Sontoloyo Monitor — VPS Agent
================================

Lightweight FastAPI agent that runs on each monitored VPN/Xray VPS and
exposes a minimal HTTP API consumed by the PT Sontoloyo Monitor dashboard.

Author: Pakde Xresx Digital Store

HTTP API (UNCHANGED — stable contract):
    GET /health                   public, no auth
    GET /api/status               requires X-API-Key header
    GET /api/system               requires X-API-Key header
    GET /api/traffic              requires X-API-Key header
    GET /api/online               requires X-API-Key header

JSON shape returned by /api/status:

{
  "ok": true,
  "uptime": 12345,            // seconds
  "cpu": 24.1,                // percent
  "ram": 41.2,                // percent
  "ping": 14,                 // ms (gateway)
  "speed": 940,               // rough Mb/s (NIC speed)
  "rx": 12345678,             // bytes
  "tx": 87654321,             // bytes
  "active_users": 87,         // SSH + Xray online sessions
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 120, "total_xray": 80
}
"""
from __future__ import annotations

import os
import re
import time
import socket
import subprocess
from typing import Optional

import psutil
from fastapi import FastAPI, Header, HTTPException, status

API_KEY = os.environ.get("SONTOLOYO_API_KEY", "change-me")
HOST = os.environ.get("SONTOLOYO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SONTOLOYO_PORT", "8787"))

app = FastAPI(title="Sontoloyo VPS Agent", version="1.0.0")


# ─────────────────────────── helpers ──────────────────────────────────────
def _check_key(key: Optional[str]) -> None:
    if not key or key != API_KEY:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")


def _service_active(name: str) -> bool:
    try:
        out = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True, text=True, timeout=2,
        )
        return out.stdout.strip() == "active"
    except Exception:
        return False


def _udp_active() -> bool:
    for n in ("udp-custom", "udp-mini", "badvpn-udpgw", "udp-zivpn"):
        if _service_active(n):
            return True
    return False


def _gateway_ping_ms() -> int:
    try:
        gw = subprocess.check_output(
            "ip route | awk '/default/ {print $3; exit}'",
            shell=True, text=True, timeout=2,
        ).strip()
        if not gw:
            return 0
        out = subprocess.check_output(
            ["ping", "-c", "1", "-W", "1", gw], text=True, timeout=3,
        )
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


def _net_rx_tx() -> tuple[int, int]:
    n = psutil.net_io_counters()
    return int(n.bytes_recv), int(n.bytes_sent)


def _count_pattern(cmd: str) -> int:
    try:
        out = subprocess.check_output(cmd, shell=True, text=True, timeout=3)
        return sum(1 for ln in out.splitlines() if ln.strip())
    except Exception:
        return 0


def _ssh_online() -> int:
    return _count_pattern("ps -ef | grep -E 'sshd:.*@' | grep -v grep || true")


def _xray_online() -> int:
    return _count_pattern(
        "ss -tn state established '( sport = :443 or sport = :80 or sport = :8443 )' "
        "| tail -n +2 || true"
    )


def _total_ssh_accounts() -> int:
    f = "/etc/sontoloyo/ssh.users"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                return sum(1 for ln in fp if ln.strip() and not ln.startswith("#"))
        except Exception:
            return 0
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
    f = "/etc/sontoloyo/xray.users"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                return sum(1 for ln in fp if ln.strip() and not ln.startswith("#"))
        except Exception:
            pass
    cfg = "/usr/local/etc/xray/config.json"
    if os.path.isfile(cfg):
        try:
            with open(cfg) as fp:
                return len(re.findall(r'"email"\s*:\s*"', fp.read()))
        except Exception:
            return 0
    return 0


# ─────────────────────────── routes ───────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "host": socket.gethostname(), "ts": int(time.time())}


@app.get("/api/status")
def status_endpoint(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    rx, tx = _net_rx_tx()
    ssh_online = _ssh_online()
    xray_online = _xray_online()
    return {
        "ok": True,
        "uptime": int(time.time() - psutil.boot_time()),
        "cpu": psutil.cpu_percent(interval=0.2),
        "ram": psutil.virtual_memory().percent,
        "ping": _gateway_ping_ms(),
        "speed": _nic_speed_mbps(),
        "rx": rx, "tx": tx,
        "active_users": ssh_online + xray_online,
        "ssh":   _service_active("ssh") or _service_active("sshd"),
        "xray":  _service_active("xray"),
        "nginx": _service_active("nginx"),
        "udp":   _udp_active(),
        "total_ssh":  _total_ssh_accounts(),
        "total_xray": _total_xray_accounts(),
    }


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
    return {"rx": rx, "tx": tx, "speed": _nic_speed_mbps()}


@app.get("/api/online")
def online(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return {"ssh": _ssh_online(), "xray": _xray_online()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
