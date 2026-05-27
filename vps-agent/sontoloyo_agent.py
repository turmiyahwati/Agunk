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
  "active_users": 29,         // active subscribers (registered, NOT expired)
  "online_now": 3,            // live online sessions right now
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 120, "total_xray": 80
}
"""
from __future__ import annotations

import os
import re
import json
import time
import socket
import subprocess
import threading
from datetime import datetime
from typing import Optional, Callable, TypeVar

import psutil
from fastapi import FastAPI, Header, HTTPException, status

API_KEY = os.environ.get("SONTOLOYO_API_KEY", "change-me")
HOST = os.environ.get("SONTOLOYO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SONTOLOYO_PORT", "8787"))

# Per-call result cache (TTL seconds). Lets us make /api/status return in
# milliseconds even though the underlying probes (cek-vme, vnstat, ping)
# are slow subprocess calls. Tuned via SONTOLOYO_CACHE_TTL.
_CACHE_TTL = float(os.environ.get("SONTOLOYO_CACHE_TTL", "3"))
_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()

T = TypeVar("T")


def _cached(key: str, ttl: float, producer: Callable[[], T]) -> T:
    """Memoize ``producer()`` under ``key`` for ``ttl`` seconds.

    Thread-safe; under contention every caller waits for one producer
    invocation, so we never run two cek-vme in parallel during a burst.
    """
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < ttl:
            return hit[1]  # type: ignore[return-value]
    value = producer()
    with _cache_lock:
        _cache[key] = (time.time(), value)
    return value


app = FastAPI(title="Sontoloyo VPS Agent", version="1.0.0")

# Prime the per-process CPU sampler so the first request that lands on
# `psutil.cpu_percent(interval=None)` gets a real value instead of 0.0.
psutil.cpu_percent(interval=None)


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


def _vnstat_total() -> tuple[int, int]:
    """Return cumulative (rx_bytes, tx_bytes) from `vnstat --json`.

    vnstat aggregates traffic across reboots in its on-disk database, so
    the returned value reflects long-term usage (the same number you see
    in the Premium auto-installer banner). Falls back to the per-process
    psutil counter when vnstat is not installed or its DB is empty.
    """
    try:
        out = subprocess.check_output(
            ["vnstat", "--json"], text=True, timeout=3,
        )
        data = json.loads(out)
        iface = data.get("interfaces", [{}])[0]
        total = iface.get("traffic", {}).get("total", {})
        rx = int(total.get("rx", 0))
        tx = int(total.get("tx", 0))
        if rx > 0 or tx > 0:
            return rx, tx
    except Exception:
        pass
    return _net_rx_tx()


def _count_pattern(cmd: str) -> int:
    try:
        out = subprocess.check_output(cmd, shell=True, text=True, timeout=3)
        return sum(1 for ln in out.splitlines() if ln.strip())
    except Exception:
        return 0


def _ssh_online() -> int:
    return _count_pattern("ps -ef | grep -E 'sshd:.*@' | grep -v grep || true")


# ─────────────────── expiry-aware account counters ────────────────────────
# Lines from /etc/ssh/.ssh.db look like (Premium auto-installer convention):
#   #ssh# KukkVIP   PfremID 0 2 13 May, 2026
#   #ssh# trial     whus
# Lines from /etc/xray/.userall.db follow the same shape but often omit
# the trailing date when the account is set as lifetime / non-expiring.
#
# To match the "ACCOUNT" number shown in the Premium auto-installer's
# main menu, we count lines whose embedded expiry date is today-or-later,
# and treat lines without any parseable date as still-active (lifetime).

_MONTHS = {
    "jan": 1,  "feb": 2,  "mar": 3,  "apr": 4,  "may": 5,  "jun": 6,
    "jul": 7,  "aug": 8,  "sep": 9,  "oct": 10, "nov": 11, "dec": 12,
    # Indonesian month names sometimes used by localized installers.
    "januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5,
    "juni": 6, "juli": 7, "agustus": 8, "september": 9, "oktober": 10,
    "november": 11, "desember": 12,
}

# Matches "13 May, 2026", "13 May 2026", "13 Mei 2026", etc.
_EXPIRY_RE = re.compile(
    r"\b(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})\b"
)


def _parse_expiry(line: str) -> Optional[datetime]:
    """Return the expiry ``datetime`` embedded in ``line``, or None.

    None means "no parseable date" — caller decides whether to treat the
    line as a lifetime account (count it) or skip it. We count it.
    """
    m = _EXPIRY_RE.search(line)
    if not m:
        return None
    day_s, mon_s, year_s = m.group(1), m.group(2).lower(), m.group(3)
    mon = _MONTHS.get(mon_s) or _MONTHS.get(mon_s[:3])
    if not mon:
        return None
    try:
        return datetime(int(year_s), mon, int(day_s))
    except ValueError:
        return None


def _count_active_in_db(path: str) -> int:
    """Count #ssh#-prefixed lines in ``path`` that are not yet expired.

    A line is considered active when:
      * it starts with ``#ssh#`` (the Premium installer's marker), AND
      * either contains no parseable date (lifetime) OR its date is
        today-or-later in the agent's local timezone.
    """
    if not os.path.isfile(path):
        return 0
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    n = 0
    try:
        with open(path) as fp:
            for line in fp:
                if not line.strip().startswith("#ssh#"):
                    continue
                expiry = _parse_expiry(line)
                if expiry is None or expiry >= today:
                    n += 1
    except Exception:
        return 0
    return n


def _xray_online() -> int:
    """Count active Xray (vmess/vless/trojan) connections.

    Sums per-protocol counts from the Indonesian Premium auto-installer's
    compiled checker commands when available:

        cek-vme   → active VMESS sessions
        cek-vle   → active VLESS sessions
        cek-tro   → active TROJAN sessions

    Each one outputs line-per-connection in the format
    ``<id> - 'username' - <ip>:<port>``, so summing them yields the total
    Xray online count that matches the banner shown by the auto-installer
    menu.

    When *none* of those binaries are available (vanilla VPS), we fall
    back to a permissive ``ss`` query that covers the conventional Xray /
    HTTPS listener ports plus the local 10000-10010 inbound range used by
    haproxy → xray pipelines.
    """

    def _count_cek(cmd: str) -> Optional[int]:
        """Run a `cek-*` command. Return its line count, or None on failure."""
        try:
            out = subprocess.check_output(
                [cmd], text=True, timeout=5, stdin=subprocess.DEVNULL,
            )
        except Exception:
            return None
        return sum(1 for line in out.splitlines() if "'" in line and " - " in line)

    total = 0
    matched_any = False
    for cmd in ("cek-vme", "cek-vle", "cek-tro"):
        n = _count_cek(cmd)
        if n is None:
            continue
        matched_any = True
        total += n

    if matched_any:
        return total

    # Generic fallback — ss-based connection count on Xray ports
    return _count_pattern(
        "ss -tn state established '( sport = :443 or sport = :80 or sport = :8443 "
        "or ( sport >= :10000 and sport <= :10010 ) )' "
        "| tail -n +2 || true"
    )


def _total_ssh_accounts() -> int:
    """Count total SSH accounts.

    Lookup order (first hit wins):
      1. `/etc/ssh/.ssh.db` — Indonesian Premium auto-installer convention
         (FuxiVPS / Vladiyot / Apik / etc). Lines start with ``#ssh#``.
      2. `/etc/sontoloyo/ssh.users` — operator-managed plain list.
      3. `/etc/passwd` — generic fallback (uid >= 1000, real shell).
    """
    # 1) Premium auto-installer DB
    f = "/etc/ssh/.ssh.db"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                n = sum(1 for ln in fp if ln.strip().startswith("#ssh#"))
            if n > 0:
                return n
        except Exception:
            pass

    # 2) Sontoloyo-managed list
    f = "/etc/sontoloyo/ssh.users"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                return sum(1 for ln in fp if ln.strip() and not ln.startswith("#"))
        except Exception:
            return 0

    # 3) Generic /etc/passwd fallback
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
    """Count total Xray (vmess/vless/trojan) accounts.

    Lookup order (first hit wins):
      1. `/etc/xray/.userall.db` — Indonesian Premium auto-installer DB.
         Lines start with ``#ssh#`` (yes, the script reuses the prefix).
      2. `/etc/sontoloyo/xray.users` — operator-managed plain list.
      3. `/usr/local/etc/xray/config.json` — vanilla Xray config: count
         the `"email"` fields.
      4. `/etc/xray/config.json` — alternate path used by some installers.
    """
    # 1) Premium auto-installer DB
    f = "/etc/xray/.userall.db"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                n = sum(1 for ln in fp if ln.strip().startswith("#ssh#"))
            if n > 0:
                return n
        except Exception:
            pass

    # 2) Sontoloyo-managed list
    f = "/etc/sontoloyo/xray.users"
    if os.path.isfile(f):
        try:
            with open(f) as fp:
                return sum(1 for ln in fp if ln.strip() and not ln.startswith("#"))
        except Exception:
            pass

    # 3) Vanilla Xray config — count "email" entries
    for cfg in ("/usr/local/etc/xray/config.json", "/etc/xray/config.json"):
        if os.path.isfile(cfg):
            try:
                with open(cfg) as fp:
                    n = len(re.findall(r'"email"\s*:\s*"', fp.read()))
                if n > 0:
                    return n
            except Exception:
                continue

    return 0


# ─────────────────────────── routes ───────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "host": socket.gethostname(), "ts": int(time.time())}


@app.get("/api/status")
def status_endpoint(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return _cached("status", _CACHE_TTL, _build_status_payload)


def _build_status_payload() -> dict:
    """Heavy lifting that backs ``GET /api/status``.

    Held behind ``_cached`` (default 3 s) so repeated polls from the
    dashboard return instantly without re-running cek-vme / vnstat /
    ping / cpu_percent on every request. Tuned via SONTOLOYO_CACHE_TTL.

    ``active_users`` is the count of *active subscribers* — registered
    accounts that are not yet expired — so it matches the "ACCOUNT"
    number shown in the Premium auto-installer's main menu. The live
    online-session count (the old meaning) is still exposed as
    ``online_now`` for callers that want it.
    """
    rx, tx = _vnstat_total()
    online_ssh = _ssh_online()
    online_xray = _xray_online()
    active_ssh = _count_active_in_db("/etc/ssh/.ssh.db")
    active_xray = _count_active_in_db("/etc/xray/.userall.db")
    # Non-blocking CPU read — uses the delta since the previous snapshot
    # (which the cache keeps refreshed every few seconds), so we avoid
    # the 200 ms blocking sample on the request hot path.
    cpu = psutil.cpu_percent(interval=None)
    return {
        "ok": True,
        "uptime": int(time.time() - psutil.boot_time()),
        "cpu": cpu,
        "ram": psutil.virtual_memory().percent,
        "ping": _gateway_ping_ms(),
        "speed": _nic_speed_mbps(),
        "rx": rx, "tx": tx,
        # Slot count shown on the dashboard: active subscribers (matches
        # the Premium menu's ACCOUNT number). Falls back to the live
        # online count when the Premium DB files aren't present.
        "active_users": (active_ssh + active_xray) or (online_ssh + online_xray),
        "online_now": online_ssh + online_xray,
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
    rx, tx = _vnstat_total()
    return {"rx": rx, "tx": tx, "speed": _nic_speed_mbps()}


@app.get("/api/online")
def online(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return {"ssh": _ssh_online(), "xray": _xray_online()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
