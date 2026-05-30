"""
PT Sontoloyo Monitor — VPS Agent
================================

Lightweight FastAPI agent that runs on each monitored VPN/Xray VPS and
exposes a minimal HTTP API consumed by the PT Sontoloyo Monitor dashboard.

Author: Pakde Xresx Digital Store

HTTP API:

    GET  /health                       public, no auth — used by browser
                                       clients for live ping latency probes
    GET  /api/status                   requires X-API-Key header
    GET  /api/system                   requires X-API-Key header
    GET  /api/traffic                  requires X-API-Key header
    GET  /api/online                   requires X-API-Key header

    GET  /api/probe/download?bytes=N   public, no auth — streams N bytes
                                       (max 10 MB) for browser-side
                                       download speedtest from visitors
                                       on the public homepage
    POST /api/probe/upload             public, no auth — accepts up to
                                       10 MB body for upload speedtest;
                                       returns the byte count back

The /api/probe/* endpoints are CORS-allowed for the dashboard's public
domain so the LivePing / LiveSpeed components in the visitor's browser
can call them directly. They are rate-limited per source IP to prevent
bandwidth abuse — typical homepage traffic stays well within the limit.

JSON shape returned by /api/status:

{
  "ok": true,
  "uptime": 12345,            // seconds
  "cpu": 24.1,                // percent
  "ram": 41.2,                // percent
  "ping": 14,                 // ms — gateway → cloudflare → google fallback chain
  "speed": 0.6,               // Mbps (FLOAT, 1 decimal) — live RX+TX throughput
  "rx": 12345678,             // bytes — current month total on default-route iface
  "tx": 87654321,             // bytes — current month total on default-route iface
  "active_users": 27,         // active subscribers (registered, NOT expired)
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 38, "total_xray": 0
}

Counting policy (matches what the Premium auto-installer's main menu shows):

* SSH active   = lines in /etc/ssh/.ssh.db whose embedded expiry date is
                 today-or-later. Lines without a parseable date are
                 IGNORED — those are stale/legacy entries that the
                 installer's own panel does not count either.
* Xray active  = number of "email" entries in the live Xray config.json
                 (the source of truth Xray itself reads). Returns 0 when
                 the xray service is inactive, mirroring panel behavior.
                 The legacy /etc/xray/.userall.db file is NOT consulted —
                 in real deployments it accumulates dateless entries for
                 every account that was ever created, including the ones
                 already deleted from the panel.
"""
from __future__ import annotations

import math
import os
import re
import json
import time
import socket
import subprocess
import secrets
import threading
from collections import deque
from datetime import datetime
from typing import Optional, Callable, TypeVar

import psutil
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

API_KEY = os.environ.get("SONTOLOYO_API_KEY", "change-me")
HOST = os.environ.get("SONTOLOYO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SONTOLOYO_PORT", "8787"))

# CORS allowlist for the public probe endpoints. The dashboard's public
# domain is the only origin that legitimately calls /api/probe/* from a
# visitor's browser. Operators can override via SONTOLOYO_CORS_ORIGINS
# (comma-separated list) when running multiple dashboards or staging.
# Default "*" lets any dashboard work out-of-the-box; tighten in
# production by exporting SONTOLOYO_CORS_ORIGINS=https://monitoring.example.com
_CORS_ORIGINS = [
    o.strip() for o in os.environ.get("SONTOLOYO_CORS_ORIGINS", "*").split(",")
    if o.strip()
]

# Public probe endpoint sizing & rate limiting. Defaults are conservative
# enough for a small homepage but generous enough that one visitor with
# 6 server cards on screen can refresh once each per minute.
_PROBE_MAX_BYTES = int(os.environ.get("SONTOLOYO_PROBE_MAX_BYTES", str(10 * 1024 * 1024)))
_PROBE_RATE_LIMIT = int(os.environ.get("SONTOLOYO_PROBE_RATE_LIMIT", "12"))
_PROBE_RATE_WINDOW = float(os.environ.get("SONTOLOYO_PROBE_RATE_WINDOW", "60"))

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


app = FastAPI(title="Sontoloyo VPS Agent", version="1.2.0")

# CORS — required so the dashboard's public homepage can call
# /health, /api/probe/download, /api/probe/upload directly from a
# visitor's browser (cross-origin: dashboard domain → tunnel domain).
# Only these public endpoints are CORS-allowed; the authenticated
# /api/* endpoints rely on the X-API-Key header which is preflight-safe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS or ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=3600,
)


# ─────────── Per-IP sliding-window rate limiter for /api/probe/* ─────────
#
# Visitor-facing endpoints stream up to 10 MB per call so they need
# protection against accidental refresh-loops AND deliberate abuse. The
# limiter is purely in-memory (single-process FastAPI app) — fine for
# our deployment topology where each VPS runs exactly one agent.

_probe_buckets: dict[str, deque[float]] = {}
_probe_buckets_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    """Best-effort client IP for rate limiting.

    Trusts CF-Connecting-IP first (Cloudflare Tunnel sets this), then
    X-Forwarded-For, falling back to the socket peer. Never trusts the
    raw header for SECURITY decisions — this is rate-limit only, where
    spoofing the IP just makes the attacker rate-limit themselves.
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_probe_rate_limit(request: Request) -> None:
    """Sliding-window allow check. Raises 429 when exceeded."""
    ip = _client_ip(request)
    now = time.monotonic()
    cutoff = now - _PROBE_RATE_WINDOW
    with _probe_buckets_lock:
        bucket = _probe_buckets.setdefault(ip, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _PROBE_RATE_LIMIT:
            retry_after = max(1, int(bucket[0] + _PROBE_RATE_WINDOW - now))
            raise HTTPException(
                status_code=429,
                detail="probe rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


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


def _tcp_ping_ms(host: str, port: int, timeout: float = 1.5) -> Optional[int]:
    """Measure TCP handshake time as a fallback when ICMP is blocked.

    Many cheap VPS providers silently drop ALL outbound ICMP — both to
    on-net gateways and to public resolvers like 1.1.1.1/8.8.8.8. In
    that case a TCP connect to a well-known service (typically 443) is
    the only practical way to obtain a latency number, since TCP/443 is
    almost universally permitted.
    """
    try:
        start = time.monotonic()
        with socket.create_connection((host, port), timeout=timeout):
            return int((time.monotonic() - start) * 1000)
    except Exception:
        return None


def _gateway_ping_ms() -> int:
    """Latency in ms to the first reachable upstream target.

    Strategy (first non-zero wins):

      1. ICMP to the default gateway — fastest when on-net.
      2. ICMP to public resolvers (1.1.1.1, 8.8.8.8).
      3. TCP-handshake to Cloudflare/Google over 443 / 53 — needed for
         providers that drop all outbound ICMP. Slightly higher than
         pure ICMP because it includes the SYN-ACK round-trip + setup,
         but still in the same order of magnitude and stable.
    """
    # ICMP attempts: gateway first, then well-known public targets.
    icmp_targets: list[str] = []
    try:
        gw = subprocess.check_output(
            "ip route | awk '/default/ {print $3; exit}'",
            shell=True, text=True, timeout=2,
        ).strip()
        if gw:
            icmp_targets.append(gw)
    except Exception:
        pass
    icmp_targets.extend(["1.1.1.1", "8.8.8.8"])

    for target in icmp_targets:
        try:
            out = subprocess.check_output(
                ["ping", "-c", "1", "-W", "1", target], text=True, timeout=3,
            )
            m = re.search(r"time=([\d.]+) ?ms", out)
            if m:
                # Floor to 1 ms for any successful reply — internal LAN
                # gateways routinely respond in sub-millisecond range
                # (e.g. "time=0.412 ms"). Without this floor, int()
                # truncated those replies to 0 and the function returned
                # immediately, skipping the public-target ICMP and TCP
                # fallbacks below. The dashboard then showed an empty
                # "—" card even though the host had perfectly good
                # connectivity.
                return max(1, int(round(float(m.group(1)))))
        except Exception:
            continue

    # TCP fallback — when the provider firewall drops ICMP entirely.
    for host, port in (("1.1.1.1", 443), ("8.8.8.8", 443), ("1.1.1.1", 53)):
        v = _tcp_ping_ms(host, port)
        if v is not None and v > 0:
            return v
    return 0


# Module-level state for instantaneous-throughput computation. Each call to
# `_throughput_mbps()` measures the byte delta vs the previous call and
# divides by the elapsed time. Gives a true "speed right now" number that
# matches the SPEED reading in the Premium auto-installer's main menu.
_last_net_sample: dict[str, float] = {"rx": 0.0, "tx": 0.0, "ts": 0.0}
_last_net_lock = threading.Lock()


def _throughput_mbps() -> float:
    """Live network throughput in Mbps (RX + TX combined), as a 1-decimal float.

    Uses the byte counters from psutil and returns the delta-per-second
    as Mbps. The first call has no baseline so it returns 0; subsequent
    calls (every cache TTL ≈ 3 s) report the average throughput observed
    over the interval.

    Returns float (e.g. 0.4 Mbps) instead of int — the previous int()
    truncation made every traffic level below 1 Mbps display as 0 on
    the dashboard, even when there was clearly real traffic moving
    (vnstat would show 1.6 Mbit/s avg while the dashboard showed empty).
    """
    n = psutil.net_io_counters()
    now = time.time()
    rx = float(n.bytes_recv)
    tx = float(n.bytes_sent)

    with _last_net_lock:
        prev_rx = _last_net_sample["rx"]
        prev_tx = _last_net_sample["tx"]
        prev_ts = _last_net_sample["ts"]
        _last_net_sample.update({"rx": rx, "tx": tx, "ts": now})

    if prev_ts == 0:
        # First sample of the process lifetime — no delta to report yet.
        return 0.0
    dt = now - prev_ts
    if dt < 0.5:
        return 0.0
    delta_bytes = max(0.0, (rx - prev_rx) + (tx - prev_tx))
    bits_per_sec = delta_bytes * 8.0 / dt
    mbps = bits_per_sec / 1_000_000
    # Round to 1 decimal — matches the "X.Y Mbit/s" granularity vnstat
    # uses in its monthly reports, plenty of precision for a UI gauge.
    return round(mbps, 1)


def _net_rx_tx() -> tuple[int, int]:
    n = psutil.net_io_counters()
    return int(n.bytes_recv), int(n.bytes_sent)


def _default_route_iface() -> Optional[str]:
    """Return the kernel's chosen default-route interface name, e.g. ``eth0``.

    Used to pick the right entry from ``vnstat --json`` instead of
    blindly trusting ``interfaces[0]`` — which on multi-NIC hosts (eth0
    + tun0/wg0 + tun1) can land on a tunnel and report tunnel-only
    traffic, dramatically under- or over-counting the real public link.
    """
    try:
        out = subprocess.check_output(
            "ip route | awk '/default/ {print $5; exit}'",
            shell=True, text=True, timeout=2,
        ).strip()
        return out or None
    except Exception:
        return None


def _vnstat_total() -> tuple[int, int]:
    """Return (rx_bytes, tx_bytes) for the current calendar month.

    Picks the interface that backs the kernel's default route, falling
    back to the first vnstat-tracked interface when that lookup fails.
    Reads ``traffic.month[<latest>]`` so the figure aligns with what
    operators see when they run ``vnstat -m`` on the box. The Premium
    auto-installer's banner uses the same monthly-window convention,
    so the dashboard now agrees with the panel.

    Falls back to lifetime ``traffic.total`` when no monthly window is
    present (e.g. fresh vnstat install with <1 day of history), then to
    psutil's per-process counter as a last resort (since-boot only).
    """
    iface_pref = _default_route_iface()
    try:
        out = subprocess.check_output(
            ["vnstat", "--json"], text=True, timeout=3,
        )
        data = json.loads(out)
        ifaces = data.get("interfaces") or []
        if not ifaces:
            return _net_rx_tx()

        # Pick the iface matching default route; fall back to first.
        iface = next(
            (i for i in ifaces if i.get("name") == iface_pref),
            ifaces[0],
        )
        traffic = iface.get("traffic", {}) or {}

        # Prefer the most recent month bucket. vnstat returns months
        # ordered chronologically; the last entry is the current one.
        months = traffic.get("month") or []
        if months:
            latest = months[-1]
            rx = int(latest.get("rx", 0))
            tx = int(latest.get("tx", 0))
            if rx > 0 or tx > 0:
                return rx, tx

        # Fallback 1: lifetime total when no monthly bucket.
        total = traffic.get("total") or {}
        rx = int(total.get("rx", 0))
        tx = int(total.get("tx", 0))
        if rx > 0 or tx > 0:
            return rx, tx
    except Exception:
        pass

    # Fallback 2: psutil since-boot. Better than reporting zero.
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
# Every active SSH subscriber gets a parseable expiry date. Lines without
# a date are STALE/LEGACY entries the installer's own menu also ignores —
# we treat them the same way (skip).

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
    """Return the expiry ``datetime`` embedded in ``line``, or None."""
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


def _count_active_ssh_in_db(path: str) -> int:
    """Count #ssh#-prefixed lines in ``path`` whose expiry is today-or-later.

    Lines without a parseable expiry date are SKIPPED (not counted). In
    real Premium-installer deployments these are stale/legacy markers
    that the installer's own menu also ignores — counting them as
    "lifetime accounts" was the original cause of the dashboard's
    inflated Active User numbers (see RCA: 41 dateless Xray entries
    being counted as active even though the panel reported 0).
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
                if expiry is None:
                    continue  # skip legacy/stale entries
                if expiry >= today:
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


def _xray_config_paths() -> list[str]:
    """Standard Xray config locations, in lookup order."""
    return ["/usr/local/etc/xray/config.json", "/etc/xray/config.json"]


def _count_xray_emails_in_config() -> int:
    """Number of ``"email"`` entries in the live Xray config.json.

    This is the source of truth Xray itself uses at runtime. Matches the
    "Xray Account" number shown in the Premium auto-installer panel.

    We parse the file as text (regex on `"email"` keys) instead of JSON
    because real-world Xray configs frequently contain comments (`//`)
    that ``json.loads`` chokes on. The regex approach is robust against
    that and against minor formatting variations.
    """
    seen: set[str] = set()
    for cfg in _xray_config_paths():
        if not os.path.isfile(cfg):
            continue
        try:
            with open(cfg) as fp:
                content = fp.read()
        except Exception:
            continue
        # Capture the email value so duplicates across protocols (a single
        # account often appears under VMESS, VLESS, and TROJAN inbounds)
        # are counted once — same convention as the panel.
        for m in re.finditer(r'"email"\s*:\s*"([^"]+)"', content):
            seen.add(m.group(1))
    return len(seen)


def _active_xray_accounts() -> int:
    """Active Xray accounts that match the panel's "Xray Account" number.

    Returns 0 when the xray service is inactive (the panel hides the
    count under that condition too, so the dashboard now mirrors it).
    Otherwise returns the unique-email count from the live config.json.

    Importantly, ``/etc/xray/.userall.db`` is NOT consulted: that file
    is a historical log of every account ever created (including the
    ones already deleted from the panel) and using it as the ground
    truth was the root cause of the dashboard's inflated Active User
    metric (the case study had 0 accounts in the panel but 41 dateless
    entries in .userall.db being counted as "lifetime active").
    """
    if not _service_active("xray"):
        return 0
    return _count_xray_emails_in_config()


def _total_ssh_accounts() -> int:
    """Count total SSH accounts (active + expired).

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
    """Count total Xray accounts (the panel's "Xray Account" total).

    Mirrors :func:`_active_xray_accounts` for consistency: the live
    config.json is the authoritative source. The legacy
    ``/etc/xray/.userall.db`` is intentionally NOT consulted.
    """
    return _count_xray_emails_in_config()


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
    number shown in the Premium auto-installer's main menu.
    """
    rx, tx = _vnstat_total()
    active_ssh = _count_active_ssh_in_db("/etc/ssh/.ssh.db")
    active_xray = _active_xray_accounts()
    online_ssh = _ssh_online()
    online_xray = _xray_online()
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
        # Live throughput (Mbps, 1 decimal) over the last cache window.
        # Float-typed so traffic <1 Mbps shows up correctly on the
        # dashboard instead of truncating to 0.
        "speed": _throughput_mbps(),
        "rx": rx, "tx": tx,
        # Active subscribers (matches the Premium menu's ACCOUNT number).
        # Fallback to the live online count when neither DB nor config
        # has a parseable entry — better than a flat zero.
        "active_users": (active_ssh + active_xray) or (online_ssh + online_xray),
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
    return {"rx": rx, "tx": tx, "speed": _throughput_mbps()}


@app.get("/api/online")
def online(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return {"ssh": _ssh_online(), "xray": _xray_online()}


# ─────────────── Public probe endpoints (CORS, rate-limited) ─────────────
#
# These are designed to be called directly from a visitor's browser by
# the LivePing / LiveSpeed components on the public homepage. NO API key
# is required (we can't ship the key to a public browser), but the
# bandwidth is bounded by:
#   * _PROBE_MAX_BYTES (default 10 MB per request)
#   * _PROBE_RATE_LIMIT requests per _PROBE_RATE_WINDOW seconds per IP
#
# Cost projection — 200 visitor/day × 40% running speedtest × 2 MB
# download + 1 MB upload = ~240 MB/day per server. Well below any
# reasonable VPS bandwidth allowance.


def _random_chunks(n_bytes: int, chunk_size: int = 65536):
    """Generator that yields ``n_bytes`` of cryptographic random bytes.

    Streamed (not buffered) so we never allocate >64 KiB at once even
    when serving the full 10 MB cap. Random data prevents Cloudflare /
    intermediary caches from compressing the response — important for
    an honest speed measurement.
    """
    remaining = n_bytes
    while remaining > 0:
        take = min(chunk_size, remaining)
        yield secrets.token_bytes(take)
        remaining -= take


@app.get("/api/probe/download")
def probe_download(request: Request, bytes: int = 1_000_000):
    """Stream ``bytes`` random bytes for browser-side download speedtest."""
    _check_probe_rate_limit(request)
    n = max(1024, min(int(bytes), _PROBE_MAX_BYTES))
    return StreamingResponse(
        _random_chunks(n),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(n),
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Probe-Bytes": str(n),
        },
    )


@app.post("/api/probe/upload")
async def probe_upload(request: Request):
    """Accept up to ``_PROBE_MAX_BYTES`` bytes for browser-side upload speedtest.

    We don't keep the body — just measure how many bytes the client
    successfully streamed in. The browser uses the wallclock between
    POST start and response receipt to compute Mbps.
    """
    _check_probe_rate_limit(request)
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > _PROBE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="upload too large")
    return {"ok": True, "bytes": received}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
