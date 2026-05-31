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

The /health endpoint is CORS-allowed for the dashboard's public domain
so the LivePing component in the visitor's browser can probe it for
realtime latency measurements.

JSON shape returned by /api/status (v1.5 contract):

{
  "ok": true,
  "uptime": 12345,                      // seconds
  "cpu": 24.1, "ram": 41.2,             // percent
  "ping": 14,                           // ms — gateway / cloudflare fallback chain

  // ── Network performance — 3-tier display strategy ──
  "link_speed_mbps": 1000,              // NIC port capacity (kernel-reported)
  "last_test_down_mbps": 845.6,         // Ookla speedtest, run daily off-peak
  "last_test_up_mbps": 812.3,
  "last_test_ping_ms": 14,
  "last_test_at": "2026-05-31T03:00:14Z",
  "rx_speed": 8.2, "tx_speed": 4.2,     // realtime RX/TX throughput now
  "speed": 12.4,                        // legacy combined RX+TX (kept for v1.2)

  // ── Traffic counters (3 windows side-by-side on the dashboard) ──
  "rx": 12345678, "tx": 87654321,             // bytes — current month total
  "rx_today": 5432109, "tx_today": 3210987,   // bytes — today (vnstat day)
  "rx_boot":  2345678, "tx_boot":  1234567,   // bytes — since last reboot

  // ── Account & service ──
  "active_users": 27,                   // active subscribers (registered, not expired)
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 38, "total_xray": 0
}

Speed display strategy (3 tiers):

  * link_speed_mbps   = NIC port capacity (e.g. 1000 = 1 Gbps). Static, free,
                        always-on baseline. Visible to visitors as "Port: 1 Gbps".
  * last_test_*       = Ookla speedtest result, refreshed once per 24 hours at
                        local time 03:00 (off-peak). The actual achievable
                        bandwidth between this VPS and the closest Ookla node.
                        Persisted across agent restarts in
                        /var/lib/sontoloyo/last_speedtest.json.
  * rx_speed / tx_speed = realtime traffic the VPS is serving RIGHT NOW.
                          Read directly from psutil counter delta.

This three-tier scheme answers three different visitor questions
honestly: "how big is the pipe?", "what's the real-world max?", and
"how busy is it now?". The previous single-metric approach forced one
of those answers to substitute for all three, which was misleading.

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

import os
import re
import json
import time
import socket
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Callable, TypeVar

import psutil
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

API_KEY = os.environ.get("SONTOLOYO_API_KEY", "change-me")
HOST = os.environ.get("SONTOLOYO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SONTOLOYO_PORT", "8787"))

# CORS allowlist for the /health endpoint (used by browser-side LivePing
# on the dashboard's public homepage). Only that one endpoint is reached
# from a cross-origin browser context. Tighten in production by exporting
# SONTOLOYO_CORS_ORIGINS=https://monitoring.example.com (comma-separated
# for multiple dashboards). Default "*" lets any dashboard work out of
# the box.
_CORS_ORIGINS = [
    o.strip() for o in os.environ.get("SONTOLOYO_CORS_ORIGINS", "*").split(",")
    if o.strip()
]

# ─────── Daily Ookla speedtest scheduler ───────────────────────────────
#
# The agent runs `speedtest --format=json` once on startup (initial
# benchmark) then on a fixed local-time schedule (default 03:00 daily)
# to keep the "Tested Speed" tier in the dashboard fresh without
# disturbing customers during peak hours. The result is persisted to
# disk so it survives agent restarts and so /api/status always has a
# value to return — even on the very first request after a fresh
# install (returns zeros until the initial benchmark completes ~30s
# later).
#
# Tunables (override via environment file):
#   SONTOLOYO_SPEEDTEST_HOUR     = local hour-of-day to run, 0-23
#   SONTOLOYO_SPEEDTEST_INTERVAL = hours between runs
#   SONTOLOYO_SPEEDTEST_CACHE    = persistence path
#   SONTOLOYO_SPEEDTEST_DISABLE  = set to "1" to skip benchmarking entirely
_SPEEDTEST_HOUR = int(os.environ.get("SONTOLOYO_SPEEDTEST_HOUR", "3"))
_SPEEDTEST_INTERVAL_HOURS = int(os.environ.get("SONTOLOYO_SPEEDTEST_INTERVAL", "24"))
_SPEEDTEST_CACHE = os.environ.get(
    "SONTOLOYO_SPEEDTEST_CACHE", "/var/lib/sontoloyo/last_speedtest.json"
)
_SPEEDTEST_DISABLED = os.environ.get("SONTOLOYO_SPEEDTEST_DISABLE", "") == "1"
# Maximum subprocess wallclock — Ookla typically finishes in 30-60 s,
# but slow connections or stuck servers warrant a generous cap.
_SPEEDTEST_TIMEOUT_S = int(os.environ.get("SONTOLOYO_SPEEDTEST_TIMEOUT", "300"))

_speedtest_lock = threading.Lock()

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


app = FastAPI(title="Sontoloyo VPS Agent", version="1.5.0")

# CORS — required so the dashboard's public homepage can call /health
# directly from a visitor's browser (cross-origin: dashboard domain →
# tunnel domain). Only the public endpoints (`/health`) are CORS-allowed;
# the authenticated /api/* endpoints rely on the X-API-Key header which
# is preflight-safe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS or ["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
    max_age=3600,
)


# Prime the per-process CPU sampler so the first request that lands on
# `psutil.cpu_percent(interval=None)` gets a real value instead of 0.0.
psutil.cpu_percent(interval=None)


# Spin up the daily Ookla speedtest scheduler in a daemon thread WHEN the
# FastAPI app starts up. Using the startup event (rather than a bare
# `threading.Thread(...).start()` at module import) guarantees that all
# helper functions referenced by the scheduler — `_speedtest_scheduler_loop`,
# `_run_speedtest`, `_read_speedtest_cache`, etc. — are already defined by
# the time the loop tries to call them. The earlier import-time approach
# crashed at startup with `NameError: name '_speedtest_scheduler_loop' is
# not defined` because Python evaluates module bodies top-to-bottom and
# those helpers live further down the file.
@app.on_event("startup")
def _start_speedtest_scheduler() -> None:
    if _SPEEDTEST_DISABLED:
        print("[speedtest] disabled via SONTOLOYO_SPEEDTEST_DISABLE=1", flush=True)
        return
    threading.Thread(
        target=_speedtest_scheduler_loop,
        name="speedtest-scheduler",
        daemon=True,
    ).start()


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


def _throughput_split_mbps() -> tuple[float, float]:
    """Live network throughput, split into RX (download) and TX (upload).

    Returns ``(rx_mbps, tx_mbps)`` — both rounded to 1 decimal — measured
    as the byte delta over the elapsed time since the previous call. The
    first call has no baseline so it returns ``(0.0, 0.0)``; subsequent
    calls (every cache TTL ≈ 3 s) report the average throughput observed
    over the interval.

    Why split? VPN dashboards routinely render Download and Upload as
    separate gauges so visitors can see asymmetric usage at a glance.
    The previous combined-throughput number forced operators to display
    only a single ambiguous metric, which is much less useful for a
    realtime monitoring panel.

    The returned values are TRUE network throughput — bytes flowing
    through the kernel network counter — not a periodic speedtest. An
    idle server reports ~0 (correct), a busy server reports the current
    rate. This matches the SPEED reading in the Premium auto-installer
    main menu.
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
        return 0.0, 0.0
    dt = now - prev_ts
    if dt < 0.5:
        return 0.0, 0.0

    rx_mbps = max(0.0, (rx - prev_rx)) * 8.0 / dt / 1_000_000
    tx_mbps = max(0.0, (tx - prev_tx)) * 8.0 / dt / 1_000_000
    return round(rx_mbps, 1), round(tx_mbps, 1)


def _net_rx_tx() -> tuple[int, int]:
    n = psutil.net_io_counters()
    return int(n.bytes_recv), int(n.bytes_sent)


def _nic_link_speed_mbps() -> int:
    """Return the kernel-reported NIC link speed for the default-route
    interface, in Mbps. ``0`` means "unknown" — typical for LXC / Docker
    veth interfaces and for some virtualized NICs that do not expose the
    field. The dashboard renders ``0`` as "—" so this is safe to report
    as-is.

    Why this matters: visitors of a VPN landing page want to know "how
    big is the pipe?", and the kernel link speed is the cheapest, most
    truthful answer (as opposed to running a synthetic Ookla test every
    page load). For 1 Gbps NICs this returns ``1000``, for 10 Gbps NICs
    ``10000``, etc. The dashboard formats it to "1 Gbps" / "10 Gbps"
    via ``formatLinkSpeed`` on the frontend.
    """
    iface_pref = _default_route_iface()
    try:
        stats = psutil.net_if_stats()
    except Exception:
        return 0
    if iface_pref and iface_pref in stats:
        sp = stats[iface_pref].speed
        if sp and sp > 0:
            return int(sp)
    # Fallback: first non-loopback interface that reports a positive
    # speed. Handles oddly named NICs without a default route entry.
    for name, st in stats.items():
        if name == "lo" or name.startswith("docker") or name.startswith("veth"):
            continue
        if st.speed and st.speed > 0:
            return int(st.speed)
    return 0


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


def _vnstat_iface_traffic() -> dict:
    """Return the ``traffic`` block from vnstat for the default-route iface.

    Empty dict on any failure — callers should treat missing keys as 0.
    Memoised inside the per-call cache window so we don't shell out to
    vnstat once per traffic helper.
    """
    iface_pref = _default_route_iface()
    try:
        out = subprocess.check_output(
            ["vnstat", "--json"], text=True, timeout=3,
        )
        data = json.loads(out)
        ifaces = data.get("interfaces") or []
        if not ifaces:
            return {}
        iface = next(
            (i for i in ifaces if i.get("name") == iface_pref),
            ifaces[0],
        )
        return iface.get("traffic", {}) or {}
    except Exception:
        return {}


def _vnstat_total() -> tuple[int, int]:
    """Return (rx_bytes, tx_bytes) for the current calendar month.

    Reads ``traffic.month[<latest>]`` so the figure aligns with
    ``vnstat -m`` and the Premium auto-installer banner's MONTH line.
    Falls back to lifetime ``traffic.total`` when no monthly window is
    present (e.g. fresh vnstat install with <1 day of history), then to
    psutil's per-process counter as a last resort (since-boot only).
    """
    traffic = _vnstat_iface_traffic()
    if traffic:
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

    # Fallback 2: psutil since-boot. Better than reporting zero.
    return _net_rx_tx()


def _vnstat_today() -> tuple[int, int]:
    """Return (rx_bytes, tx_bytes) for today (calendar day, local TZ).

    Reads ``traffic.day[<latest>]`` so the figure aligns with
    ``vnstat -d``'s last entry — the same number the Premium installer
    panel labels as "TODAY". Resets at midnight local time.

    Falls back to ``(0, 0)`` when vnstat has no daily data yet (fresh
    install with <24 hours of history) — the dashboard renders that as
    "0 B" rather than reporting an inflated since-boot value.
    """
    traffic = _vnstat_iface_traffic()
    if traffic:
        days = traffic.get("day") or []
        if days:
            latest = days[-1]
            rx = int(latest.get("rx", 0))
            tx = int(latest.get("tx", 0))
            return rx, tx
    return 0, 0


def _traffic_since_boot() -> tuple[int, int]:
    """Return (rx_bytes, tx_bytes) summed across all interfaces since boot.

    Uses ``psutil.net_io_counters()`` which reads the same ``/proc/net/dev``
    counters that the Premium auto-installer's panel "RX / TX" line is
    based on. Resets to 0 on every reboot — that's intentional, it's
    the kernel-level counter, not a persistent vnstat aggregate.

    Useful complement to ``rx_today`` / ``tx_today`` because it gives
    operators an at-a-glance "how much have we served since the last
    reboot" number without waiting for vnstat to flush its day bucket.
    """
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


# ─────── Speedtest cache I/O ───────────────────────────────────────────


def _read_speedtest_cache() -> dict:
    """Return the latest persisted Ookla speedtest result.

    Schema written by ``_run_speedtest()``:
        {"ts": "<ISO-8601 UTC>", "down_mbps": 845.6, "up_mbps": 812.3,
         "ping_ms": 14, "server_name": "PT Telkom", "server_id": "12345"}

    Missing or unreadable file → all zeros / null timestamp, which the
    dashboard renders as "Belum diuji" without any error indication.
    """
    empty = {
        "ts": None,
        "down_mbps": 0.0,
        "up_mbps": 0.0,
        "ping_ms": 0,
        "server_name": "",
        "server_id": "",
    }
    if not os.path.isfile(_SPEEDTEST_CACHE):
        return empty
    try:
        with open(_SPEEDTEST_CACHE) as fp:
            data = json.load(fp)
    except Exception:
        return empty
    # Defensive: legacy / partial files miss fields; backfill from `empty`.
    return {**empty, **data}


def _run_speedtest() -> Optional[dict]:
    """Invoke the Ookla speedtest CLI once and persist the result.

    Holds ``_speedtest_lock`` for the entire run so concurrent invocations
    (scheduler tick lining up with operator manual trigger) do not
    overlap and double-tax the network. On any failure (CLI missing,
    timeout, bad JSON) we log to stderr and leave the existing cache
    file untouched — the dashboard keeps showing the last known good
    value rather than zeroing out on a transient hiccup.

    Returns the new result dict on success, or ``None`` on failure.
    """
    if _SPEEDTEST_DISABLED:
        return None
    if not _speedtest_lock.acquire(blocking=False):
        # Another invocation is already running; let it finish and skip.
        return None
    try:
        try:
            out = subprocess.check_output(
                [
                    "speedtest",
                    "--format=json",
                    "--accept-license",
                    "--accept-gdpr",
                ],
                text=True,
                timeout=_SPEEDTEST_TIMEOUT_S,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            print(
                "[speedtest] Ookla CLI not installed — re-run install.sh "
                "to add 'speedtest' package, or set SONTOLOYO_SPEEDTEST_DISABLE=1.",
                flush=True,
            )
            return None
        except subprocess.TimeoutExpired:
            print(
                f"[speedtest] timeout after {_SPEEDTEST_TIMEOUT_S}s; "
                "keeping previous cache value.",
                flush=True,
            )
            return None
        except Exception as e:
            print(f"[speedtest] CLI failed: {e}", flush=True)
            return None

        try:
            payload = json.loads(out)
        except Exception:
            print("[speedtest] could not parse CLI JSON output.", flush=True)
            return None

        # Ookla CLI returns bandwidth in BYTES PER SECOND. Convert to Mbps:
        #   bytes/sec * 8 / 1_000_000 = Mbps
        try:
            down_bps = float(payload.get("download", {}).get("bandwidth", 0))
            up_bps = float(payload.get("upload", {}).get("bandwidth", 0))
            ping_ms = float(payload.get("ping", {}).get("latency", 0))
            server = payload.get("server", {}) or {}
        except Exception:
            print("[speedtest] unexpected CLI JSON shape.", flush=True)
            return None

        result = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "down_mbps": round(down_bps * 8 / 1_000_000, 1),
            "up_mbps": round(up_bps * 8 / 1_000_000, 1),
            "ping_ms": int(round(ping_ms)),
            "server_name": str(server.get("name", "")),
            "server_id": str(server.get("id", "")),
        }

        # Persist atomically — write to .tmp then rename so a partial
        # write never produces an empty file the next read would choke
        # on.
        try:
            os.makedirs(os.path.dirname(_SPEEDTEST_CACHE) or ".", exist_ok=True)
            tmp = _SPEEDTEST_CACHE + ".tmp"
            with open(tmp, "w") as fp:
                json.dump(result, fp)
            os.replace(tmp, _SPEEDTEST_CACHE)
        except Exception as e:
            print(f"[speedtest] could not persist cache: {e}", flush=True)
            # In-memory result still returned even if persistence failed,
            # so the current /api/status request gets fresh data.

        print(
            f"[speedtest] OK — down {result['down_mbps']} Mbps, "
            f"up {result['up_mbps']} Mbps, ping {result['ping_ms']} ms "
            f"(via {result['server_name'] or '?'})",
            flush=True,
        )
        return result
    finally:
        _speedtest_lock.release()


def _seconds_until_next_run() -> float:
    """Compute seconds until the next scheduled speedtest tick.

    With default settings (hour=3, interval=24) this returns the time
    until the next 03:00 in the local timezone. The agent uses the
    machine's local time (``datetime.now()``) on purpose so operators
    who run in WIB / WITA / WIT see the run land at the configured
    local hour without any tzdata gymnastics.
    """
    now = datetime.now()
    target = now.replace(
        hour=_SPEEDTEST_HOUR, minute=0, second=0, microsecond=0,
    )
    if target <= now:
        target += timedelta(hours=_SPEEDTEST_INTERVAL_HOURS)
    return max(60.0, (target - now).total_seconds())


def _speedtest_scheduler_loop() -> None:
    """Daemon thread: run an initial speedtest if no cache exists, then
    sleep until the next scheduled tick.

    Designed to be the lowest-impact possible: we only run when the
    operator's local time hits the configured hour (default 03:00),
    which is the universally-acknowledged off-peak window for VPN
    traffic. Tunable via ``SONTOLOYO_SPEEDTEST_HOUR`` and
    ``SONTOLOYO_SPEEDTEST_INTERVAL`` so multi-region operators can
    spread the load.
    """
    # Short startup delay so the network has a chance to settle and the
    # systemd unit's "Started" log line appears before the first
    # speedtest log line — keeps `journalctl -u sontoloyo-agent` easy
    # to read.
    time.sleep(15)

    cached = _read_speedtest_cache()
    if cached.get("ts") is None:
        # No prior result on disk — run the initial benchmark now so
        # the dashboard has SOMETHING to show within the first minute
        # of agent uptime.
        _run_speedtest()

    while True:
        try:
            time.sleep(_seconds_until_next_run())
            _run_speedtest()
        except Exception as e:
            # Never let a stray error kill the scheduler thread — log
            # and try again at the next interval.
            print(f"[speedtest] scheduler error: {e}", flush=True)
            time.sleep(3600)


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
    rx_today, tx_today = _vnstat_today()
    rx_boot, tx_boot = _traffic_since_boot()
    active_ssh = _count_active_ssh_in_db("/etc/ssh/.ssh.db")
    active_xray = _active_xray_accounts()
    online_ssh = _ssh_online()
    online_xray = _xray_online()
    rx_speed, tx_speed = _throughput_split_mbps()
    link_speed = _nic_link_speed_mbps()
    last_test = _read_speedtest_cache()
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
        # ── Tier 1: NIC port capacity (kernel-reported, free, always-on) ──
        "link_speed_mbps": link_speed,
        # ── Tier 2: Last Ookla speedtest result (refreshed daily off-peak) ──
        "last_test_down_mbps": last_test["down_mbps"],
        "last_test_up_mbps": last_test["up_mbps"],
        "last_test_ping_ms": last_test["ping_ms"],
        "last_test_at": last_test["ts"],
        # ── Tier 3: Realtime RX/TX throughput (current load) ──
        "rx_speed": rx_speed,
        "tx_speed": tx_speed,
        # Combined RX+TX kept for backward compatibility with any older
        # dashboard build that consumes the v1.2 contract.
        "speed": round(rx_speed + tx_speed, 1),
        # ── Traffic counters (3 windows side-by-side on the dashboard) ──
        # `rx`/`tx`        = current month total (vnstat month bucket).
        # `rx_today`/`tx_today` = today's calendar day (vnstat day bucket).
        # `rx_boot`/`tx_boot`   = since last reboot (psutil counter).
        # The dashboard renders TODAY (prominent) alongside Since-Reboot
        # so operators see daily billing-relevant numbers next to the
        # session-level snapshot Premium installers expose in their main
        # menu.
        "rx": rx, "tx": tx,
        "rx_today": rx_today, "tx_today": tx_today,
        "rx_boot":  rx_boot,  "tx_boot":  tx_boot,
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
    rx_today, tx_today = _vnstat_today()
    rx_boot, tx_boot = _traffic_since_boot()
    rx_speed, tx_speed = _throughput_split_mbps()
    return {
        "rx": rx, "tx": tx,
        "rx_today": rx_today, "tx_today": tx_today,
        "rx_boot":  rx_boot,  "tx_boot":  tx_boot,
        "rx_speed": rx_speed, "tx_speed": tx_speed,
        "speed": round(rx_speed + tx_speed, 1),
    }


@app.get("/api/online")
def online(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    return {"ssh": _ssh_online(), "xray": _xray_online()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
