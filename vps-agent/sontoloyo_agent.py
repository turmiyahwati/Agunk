"""
PT Sontoloyo Monitor — VPS Agent
================================

Lightweight FastAPI agent that runs on each monitored VPN/Xray VPS and
exposes a minimal HTTP API consumed by the PT Sontoloyo Monitor dashboard.

Author: Pakde Xresx Digital Store

HTTP API:

    GET  /health                       public, no auth — generic
                                       liveness probe (used by ops scripts
                                       and the systemd service test)
    GET  /api/status                   requires X-API-Key header
    GET  /api/system                   requires X-API-Key header
    GET  /api/traffic                  requires X-API-Key header
    GET  /api/online                   requires X-API-Key header

JSON shape returned by /api/status (v1.7 contract):

{
  "ok": true,
  "uptime": 12345,                      // seconds
  "cpu": 24.1, "ram": 41.2,             // percent

  // ── Network performance — 2-tier display strategy ──
  "last_test_down_mbps": 845.6,         // Ookla speedtest, runs every
  "last_test_up_mbps": 812.3,           // SONTOLOYO_SPEEDTEST_INTERVAL
  "last_test_ping_ms": 14,              // hours from the last run
  "last_test_at": "2026-05-31T03:00:14Z",
  "rx_speed": 8.2, "tx_speed": 4.2,     // realtime RX/TX throughput now
  "speed": 12.4,                        // legacy combined RX+TX (kept for v1.2)

  // ── Traffic counters (3 windows side-by-side on the dashboard) ──
  "rx": 12345678, "tx": 87654321,             // bytes — current month total
  "rx_today": 5432109, "tx_today": 3210987,   // bytes — today (vnstat day)
  "rx_boot":  2345678, "tx_boot":  1234567,   // bytes — since last reboot

  // ── Account & service ──
  "active_users": 27,                   // active subscribers (registered, not expired)
  "active_logins": 12,                  // currently-connected sessions (SSH + Xray)
  "ssh": true, "xray": true, "nginx": true, "udp": false,
  "total_ssh": 38, "total_xray": 0,

  // ── CREATE-event feed ──
  // Drained per request, populated by the file watcher whenever a new
  // SSH / vmess / vless / trojan account appears in the on-disk stores.
  // Empty list when nothing new since the previous /api/status call.
  "events": [
    {"kind": "VMESS", "ts": "2026-05-31T11:48:02Z"}
  ]
}

Speed display strategy (2 tiers):

  * last_test_*       = Ookla speedtest result, refreshed once per 24 hours at
                        local time 03:00 (off-peak). The actual achievable
                        bandwidth between this VPS and the closest Ookla node.
                        Persisted across agent restarts in
                        /var/lib/sontoloyo/last_speedtest.json.
  * rx_speed / tx_speed = realtime traffic the VPS is serving RIGHT NOW.
                          Read directly from psutil counter delta.

This two-tier scheme answers two different visitor questions honestly:
"what's the real-world max?" and "how busy is it now?". A previous
"Port Capacity" tier (kernel-reported NIC link speed) was removed
because it returned 0 / 10 Mbps on most LXC/Docker/virtualized
deployments and was misleading visitors more than informing them.

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
import hashlib
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Callable, TypeVar

import psutil
from fastapi import FastAPI, Header, HTTPException, status

API_KEY = os.environ.get("SONTOLOYO_API_KEY", "change-me")
HOST = os.environ.get("SONTOLOYO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SONTOLOYO_PORT", "8787"))

# ─────── Daily Ookla speedtest scheduler ───────────────────────────────
#
# The agent runs `speedtest --format=json` once on startup (initial
# benchmark) then on a pure interval schedule:
#
#   next_run = (last_run_ts in cache file) + SONTOLOYO_SPEEDTEST_INTERVAL hours
#
# We deliberately abandoned the previous "anchor hour + interval" scheme
# (run at hour=03:00, then add interval) because it was bug-prone for
# short intervals: if `now >= anchor_today + interval`, the math fell
# into a 60-second tight loop. The new logic has only one knob —
# interval — so a config like `SONTOLOYO_SPEEDTEST_INTERVAL=5` simply
# means "run a fresh benchmark every 5 hours from the previous run",
# regardless of clock time.
#
# Tunables (override via environment file):
#   SONTOLOYO_SPEEDTEST_INTERVAL = hours between runs (default 24)
#   SONTOLOYO_SPEEDTEST_CACHE    = persistence path
#   SONTOLOYO_SPEEDTEST_DISABLE  = set to "1" to skip benchmarking entirely
#   SONTOLOYO_SPEEDTEST_HOUR     = (deprecated, ignored — kept readable
#                                   for back-compat only; safe to remove
#                                   from existing /etc/sontoloyo-agent.env)
_SPEEDTEST_INTERVAL_HOURS = int(os.environ.get("SONTOLOYO_SPEEDTEST_INTERVAL", "24"))
_SPEEDTEST_CACHE = os.environ.get(
    "SONTOLOYO_SPEEDTEST_CACHE", "/var/lib/sontoloyo/last_speedtest.json"
)
_SPEEDTEST_DISABLED = os.environ.get("SONTOLOYO_SPEEDTEST_DISABLE", "") == "1"
# Maximum subprocess wallclock — Ookla typically finishes in 30-60 s,
# but slow connections or stuck servers warrant a generous cap.
_SPEEDTEST_TIMEOUT_S = int(os.environ.get("SONTOLOYO_SPEEDTEST_TIMEOUT", "300"))

_speedtest_lock = threading.Lock()

# ─────── CREATE-event watcher ───────────────────────────────────────────
#
# The dashboard's "Realtime Activity" feed surfaces account-creation
# events (CREATE SSH / VMESS / VLESS / TROJAN) alongside the existing
# server status transitions. We obtain these events without modifying
# the operator's autoscript by diffing the on-disk account stores
# every WATCHER_INTERVAL seconds:
#
#   * SSH:  /etc/ssh/.ssh.db          (Premium auto-installer convention)
#   * Xray: /usr/local/etc/xray/config.json or /etc/xray/config.json
#
# The agent stores the previous snapshot in memory and emits a CREATE
# event for every entry that appears in the new snapshot but not the
# old one. Snapshots are stored as opaque hashes / (email, protocol)
# tuples — we deliberately never keep usernames or emails in memory
# longer than the few microseconds it takes to compute the diff, and
# we never include them in the payload sent to the dashboard.
#
# The agent buffers events in a bounded ring (default 100). Each call
# to /api/status drains the buffer into the response and clears it,
# guaranteeing each event is delivered exactly once under normal
# operation. If the dashboard is unreachable for longer than the
# buffer can hold (e.g. >100 new accounts between syncs) the oldest
# events are dropped — that is acceptable trade-off vs unbounded
# memory growth.
_WATCHER_INTERVAL_S = float(os.environ.get("SONTOLOYO_WATCHER_INTERVAL", "3"))
_WATCHER_DISABLED = os.environ.get("SONTOLOYO_WATCHER_DISABLE", "") == "1"
_EVENT_BUFFER_MAX = int(os.environ.get("SONTOLOYO_EVENT_BUFFER", "100"))

_events_lock = threading.Lock()
_events_buffer: list[dict] = []  # FIFO; trimmed to _EVENT_BUFFER_MAX
_ssh_snapshot: set[str] = set()  # sha256-truncated hashes of #ssh# lines
_xray_snapshot: set[tuple[str, str]] = set()  # (email, "VMESS"|"VLESS"|"TROJAN") from config.json
_xray_db_snapshot: set[tuple[str, str]] = set()  # (line_hash, protocol) from /etc/<proto>/.<proto>.db

# Per-call result cache (TTL seconds). Lets us make /api/status return in
# milliseconds even though the underlying probes (cek-vme, vnstat, ping)
# are slow subprocess calls. Tuned via SONTOLOYO_CACHE_TTL.
_CACHE_TTL = float(os.environ.get("SONTOLOYO_CACHE_TTL", "5"))
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


app = FastAPI(title="Sontoloyo VPS Agent", version="1.7.1")


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
def _start_background_threads() -> None:
    if not _SPEEDTEST_DISABLED:
        threading.Thread(
            target=_speedtest_scheduler_loop,
            name="speedtest-scheduler",
            daemon=True,
        ).start()
    else:
        print("[speedtest] disabled via SONTOLOYO_SPEEDTEST_DISABLE=1", flush=True)

    if not _WATCHER_DISABLED:
        threading.Thread(
            target=_watcher_loop,
            name="account-watcher",
            daemon=True,
        ).start()
    else:
        print("[watcher] disabled via SONTOLOYO_WATCHER_DISABLE=1", flush=True)


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
    Cached for 60 seconds (vnstat itself only updates its rolling
    counters on a per-minute cadence, so re-running the binary more
    often than that is pure overhead). The cache also amortises the
    cost across the three helpers — `_vnstat_total`, `_vnstat_today`,
    and any caller of `/api/traffic` — so a single tick of the agent
    cost ~1 vnstat shell-out per minute instead of one per status
    request.
    """
    return _cached("vnstat_traffic", 60.0, _vnstat_iface_traffic_uncached)


def _vnstat_iface_traffic_uncached() -> dict:
    """Actual vnstat shell-out. Wrapped by the public helper above."""
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

    Pure interval-based: read the cached `last_test["ts"]` from disk,
    add SONTOLOYO_SPEEDTEST_INTERVAL hours, return the delta to now
    (clamped to a 60 s minimum so a clock skew or stale cache cannot
    spin the loop into a tight CPU burn).

    When the cache is empty / unreadable / has no timestamp, returns
    60 s — the loop will then attempt a benchmark run immediately,
    which is the desired behaviour for a fresh agent install.
    """
    cached = _read_speedtest_cache()
    last_iso = cached.get("ts")
    if not last_iso:
        return 60.0
    try:
        # Cache stores ISO-8601 with a `Z` suffix or `+00:00`. Both
        # variants parse fine via `fromisoformat` once we normalise.
        last = datetime.fromisoformat(str(last_iso).replace("Z", "+00:00"))
    except Exception:
        return 60.0
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    elapsed = (now - last).total_seconds()
    interval_s = max(1, _SPEEDTEST_INTERVAL_HOURS) * 3600.0
    remaining = interval_s - elapsed
    return max(60.0, remaining)


def _speedtest_scheduler_loop() -> None:
    """Daemon thread: run a benchmark whenever the previous result is
    older than SONTOLOYO_SPEEDTEST_INTERVAL hours.

    The first iteration tolerates a freshly-installed agent (empty
    cache → run immediately so the dashboard's "Tested Speed" tile
    shows a value within a minute of agent start). After that, the
    loop simply sleeps until the cache file's `ts` field is older
    than the interval and runs again.

    Designed to be the lowest-impact possible: we only run when the
    interval is actually exceeded, so a 5-hour cadence really does
    cost ~6 GB/month per server and not more (one Ookla benchmark is
    ~200 MB).
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
            wait = _seconds_until_next_run()
            print(
                f"[speedtest] next run in {wait/3600:.1f}h "
                f"(interval={_SPEEDTEST_INTERVAL_HOURS}h)",
                flush=True,
            )
            time.sleep(wait)
            _run_speedtest()
        except Exception as e:
            # Never let a stray error kill the scheduler thread — log
            # and try again at the next interval.
            print(f"[speedtest] scheduler error: {e}", flush=True)
            time.sleep(3600)


# ─────────────────────────── account watcher ──────────────────────────
#
# Detects newly-created VPN accounts by snapshotting the on-disk
# account stores periodically and emitting a CREATE event for every
# entry that appears in the new snapshot but not the old one. Sees
# every kind of account the operator's autoscript creates (FuxiVPS /
# Vladiyot / Apik / etc) without requiring any modification to those
# scripts.

def _ssh_signatures(path: str = "/etc/ssh/.ssh.db") -> set[str]:
    """Return short hashes of every `#ssh#`-prefixed line in `path`.

    We hash so that no usernames stay in the agent's process memory
    longer than a single read cycle. Truncating to 16 hex chars (64
    bits) gives a collision probability well below 1 in 10^9 even with
    100k accounts — more than enough for diff detection.
    """
    if not os.path.isfile(path):
        return set()
    sigs: set[str] = set()
    try:
        with open(path) as fp:
            for line in fp:
                stripped = line.strip()
                if not stripped.startswith("#ssh#"):
                    continue
                sigs.add(hashlib.sha256(stripped.encode()).hexdigest()[:16])
    except Exception:
        return set()
    return sigs


def _xray_email_protocol_pairs() -> set[tuple[str, str]]:
    """Return the set of `(email_hash, protocol)` tuples seen across
    every Xray inbound in the live config.json.

    Strategy: walk the raw config text linearly. Each time we hit a
    `"protocol": "vmess|vless|trojan"` token we open a window that
    extends until the NEXT protocol token (or 10 KB, whichever comes
    first), and harvest every `"email": "..."` value inside that
    window — those are the emails attached to that specific inbound.
    Emails are SHA-256 hashed before we store them so PII never
    persists in agent memory.

    A single subscriber that exists across multiple inbounds (very
    common for "multi-protocol" accounts that the autoscript creates
    in vmess + vless + trojan in one shot) yields multiple tuples
    — and therefore multiple CREATE events on first observation,
    which matches the dashboard's labels CREATE VMESS / CREATE VLESS
    / CREATE TROJAN that the operator wants to see.

    Multi-path resolution: previously this function returned after the
    FIRST config path that existed on disk, which meant a 3-byte
    placeholder file at /usr/local/etc/xray/config.json shadowed the
    real 6 KB file at /etc/xray/config.json — leaving the dashboard
    convinced the box ran zero Xray accounts. We now read every path
    that exists AND is large enough to plausibly contain a real config
    (>= 100 bytes) and union the results, so a placeholder cannot
    silently hide the live config.
    """
    pairs: set[tuple[str, str]] = set()
    for cfg in _xray_config_paths():
        if not os.path.isfile(cfg):
            continue
        try:
            if os.path.getsize(cfg) < 100:
                # Placeholder / stub file — autoscripts often `touch`
                # the canonical path to make the directory exist while
                # writing the real config elsewhere.
                continue
        except Exception:
            continue
        try:
            with open(cfg) as fp:
                content = fp.read()
        except Exception:
            continue
        for m in re.finditer(r'"protocol"\s*:\s*"(vmess|vless|trojan)"', content, re.IGNORECASE):
            protocol = m.group(1).upper()
            start = m.end()
            window = content[start:start + 10000]
            next_p = re.search(r'"protocol"\s*:\s*"', window)
            if next_p:
                window = window[:next_p.start()]
            for em in re.finditer(r'"email"\s*:\s*"([^"]+)"', window):
                email = em.group(1)
                email_hash = hashlib.sha256(email.encode()).hexdigest()[:16]
                pairs.add((email_hash, protocol))
    return pairs


# Per-protocol Premium-installer database paths.
#
# The Vladiyot / FuxiVPS / Apik family of autoscripts maintains a flat
# text file per protocol under /etc/<protocol>/.<protocol>.db with one
# `### user expirydate` line per active subscriber. These files are the
# autoscript's source of truth and are MUCH more reliable than parsing
# config.json — many autoscripts edit config.json minimally and rely on
# the db files for state.
_XRAY_DB_PATHS: dict[str, tuple[str, ...]] = {
    "VMESS":  ("/etc/vmess/.vmess.db",   "/etc/xray/.vmess.db"),
    "VLESS":  ("/etc/vless/.vless.db",   "/etc/xray/.vless.db"),
    "TROJAN": ("/etc/trojan/.trojan.db", "/etc/xray/.trojan.db"),
}


def _xray_db_signatures() -> set[tuple[str, str]]:
    """Return `(line_hash, protocol)` tuples for every entry in the
    autoscript-managed per-protocol databases.

    Each line is sha256-truncated to 16 hex chars before being stored
    so usernames / expiry dates never live in agent memory beyond the
    few microseconds it takes to compute the diff. Empty lines and
    lines starting with `#!` (admin / reserved markers) are skipped.

    Compared to the JSON parser above this is dramatically cheaper
    (one stat + read per protocol per tick) AND more compatible with
    the typical Indonesian Premium installer convention where the
    .vmess.db / .vless.db / .trojan.db files are the canonical state,
    not config.json.
    """
    sigs: set[tuple[str, str]] = set()
    for protocol, paths in _XRAY_DB_PATHS.items():
        for path in paths:
            if not os.path.isfile(path):
                continue
            try:
                with open(path) as fp:
                    for line in fp:
                        stripped = line.strip()
                        if not stripped:
                            continue
                        # Skip `#!` admin / reserved-marker lines that
                        # some autoscripts insert at install time —
                        # those are not real subscribers.
                        if stripped.startswith("#!"):
                            continue
                        sig = hashlib.sha256(stripped.encode()).hexdigest()[:16]
                        sigs.add((sig, protocol))
            except Exception:
                continue
            # Use the first path that exists per-protocol; the secondary
            # paths in the tuple are operator-specific fallbacks.
            break
    return sigs


def _emit_event(kind: str) -> None:
    """Append a CREATE event to the bounded ring buffer.

    The dashboard pulls events from /api/status and clears them, so
    in normal operation the buffer rarely holds more than a handful
    of items. The hard cap (`_EVENT_BUFFER_MAX`) only matters during
    extended dashboard outages, where the oldest events are dropped
    instead of letting the buffer grow without bound.
    """
    ev = {
        "kind": kind,
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    with _events_lock:
        _events_buffer.append(ev)
        if len(_events_buffer) > _EVENT_BUFFER_MAX:
            # Drop oldest first.
            del _events_buffer[: len(_events_buffer) - _EVENT_BUFFER_MAX]


def _drain_events() -> list[dict]:
    """Return all buffered events and clear the buffer atomically.

    Called once per /api/status response. After draining, the events
    are gone from agent memory — they live only in the dashboard's
    Activity table at that point.
    """
    with _events_lock:
        out = list(_events_buffer)
        _events_buffer.clear()
    return out


def _watcher_loop() -> None:
    """Daemon thread: poll on-disk account stores and emit events.

    Three independent sources are watched per tick — each gets its own
    snapshot so a deletion in one source does not cancel out a creation
    in another:

      * SSH lines in /etc/ssh/.ssh.db                 → SSH events
      * Per-protocol DB files /etc/<proto>/.<proto>.db → V*/TROJAN events
      * `"email"` fields in the live xray config.json → V*/TROJAN events
        (secondary; only catches autoscripts that mirror entries into
        config.json — useful as a fallback when the .db files are
        absent on a non-standard installer)

    The very first iteration runs in "snapshot mode" — it captures
    the current state without emitting events. Otherwise every
    pre-existing account would be reported as freshly-created at
    agent startup, flooding the dashboard's activity feed with
    history. From the second iteration onwards, only DIFFs versus
    the previous snapshot are emitted.

    The xray-config and xray-db sources can BOTH detect the same new
    account (when the autoscript writes to both places). The dashboard
    de-duplicates such collisions on its side via the createdAt
    timestamp + kind + serverName tuple match within a 5-second
    window — see lib/monitor.ts.
    """
    global _ssh_snapshot, _xray_snapshot, _xray_db_snapshot
    # Initial snapshot.
    try:
        _ssh_snapshot = _ssh_signatures()
        _xray_snapshot = _xray_email_protocol_pairs()
        _xray_db_snapshot = _xray_db_signatures()
        print(
            f"[watcher] initial snapshot: ssh={len(_ssh_snapshot)} "
            f"xray_cfg={len(_xray_snapshot)} xray_db={len(_xray_db_snapshot)}",
            flush=True,
        )
    except Exception as e:
        print(f"[watcher] initial snapshot failed: {e}", flush=True)

    while True:
        try:
            time.sleep(_WATCHER_INTERVAL_S)

            # SSH diff.
            cur_ssh = _ssh_signatures()
            new_ssh = cur_ssh - _ssh_snapshot
            if new_ssh:
                for _ in new_ssh:
                    _emit_event("SSH")
            _ssh_snapshot = cur_ssh

            # Xray config.json diff (per-inbound emails).
            cur_xray = _xray_email_protocol_pairs()
            new_xray = cur_xray - _xray_snapshot
            if new_xray:
                for _, protocol in new_xray:
                    _emit_event(protocol)
            _xray_snapshot = cur_xray

            # Xray per-protocol .db file diff (autoscript convention).
            cur_xray_db = _xray_db_signatures()
            new_xray_db = cur_xray_db - _xray_db_snapshot
            if new_xray_db:
                for _, protocol in new_xray_db:
                    _emit_event(protocol)
            _xray_db_snapshot = cur_xray_db
        except Exception as e:
            print(f"[watcher] error: {e}", flush=True)
            time.sleep(30)


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
        # ── Tier 1: Last Ookla speedtest result (refreshed daily off-peak) ──
        "last_test_down_mbps": last_test["down_mbps"],
        "last_test_up_mbps": last_test["up_mbps"],
        "last_test_ping_ms": last_test["ping_ms"],
        "last_test_at": last_test["ts"],
        # ── Tier 2: Realtime RX/TX throughput (current load) ──
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
        # Live login count — currently-connected sessions (SSH + Xray).
        # Distinct from `active_users` (which counts subscribers). Drives
        # the dashboard's "Live Metrics → Users" chart so visitors see
        # real-time usage instead of subscription totals.
        "active_logins": online_ssh + online_xray,
        "ssh":   _service_active("ssh") or _service_active("sshd"),
        "xray":  _service_active("xray"),
        "nginx": _service_active("nginx"),
        "udp":   _udp_active(),
        "total_ssh":  _total_ssh_accounts(),
        "total_xray": _total_xray_accounts(),
        # CREATE-event drain. The watcher thread populates this buffer
        # whenever it sees a new entry in /etc/ssh/.ssh.db or the xray
        # config; we drain-and-clear here so each event is delivered
        # to the dashboard exactly once. Empty list when nothing new
        # since the previous /api/status request.
        "events": _drain_events(),
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
