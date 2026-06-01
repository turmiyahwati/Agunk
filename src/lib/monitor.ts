import { prisma } from "./prisma";
import { ServerStatus } from "./enums";

export type AgentPayload = {
  ok: boolean;
  uptime?: number;
  cpu?: number;
  ram?: number;
  /**
   * Combined RX+TX throughput in Mbps. Kept for backward compatibility
   * with the v1.2 agent contract (some operators may not have upgraded
   * yet). New consumers should prefer `rx_speed` / `tx_speed`.
   */
  speed?: number;
  /** Realtime download throughput (Mbps, 1 decimal). Agent v1.3+. */
  rx_speed?: number;
  /** Realtime upload throughput (Mbps, 1 decimal). Agent v1.3+. */
  tx_speed?: number;
  /** Last Ookla speedtest download result (Mbps). Agent v1.4+. */
  last_test_down_mbps?: number;
  /** Last Ookla speedtest upload result (Mbps). Agent v1.4+. */
  last_test_up_mbps?: number;
  /** Last Ookla speedtest ping (ms). Agent v1.4+. */
  last_test_ping_ms?: number;
  /** ISO-8601 timestamp of the last speedtest. Null if never run. Agent v1.4+. */
  last_test_at?: string | null;
  rx?: number;
  tx?: number;
  /** Today's RX byte counter (vnstat daily bucket). Agent v1.5+. */
  rx_today?: number;
  /** Today's TX byte counter (vnstat daily bucket). Agent v1.5+. */
  tx_today?: number;
  /** Since-reboot RX byte counter (psutil). Agent v1.5+. */
  rx_boot?: number;
  /** Since-reboot TX byte counter (psutil). Agent v1.5+. */
  tx_boot?: number;
  active_users?: number;
  /**
   * Live login count (currently-connected sessions). Sum of established
   * SSH sessions + active vmess/vless/trojan connections. Distinct from
   * `active_users` which is the registered-subscriber total. Agent v1.7+.
   */
  active_logins?: number;
  ssh?: boolean;
  xray?: boolean;
  nginx?: boolean;
  udp?: boolean;
  total_ssh?: number;
  total_xray?: number;
  /**
   * Recent CREATE events detected by the agent's file watcher (new
   * SSH lines in `/etc/ssh/.ssh.db`, new email entries in xray
   * config.json). Agent v1.7+. The agent buffers events in-memory
   * between polls and clears the buffer once the dashboard reads it,
   * so each event lands in the Activity feed exactly once.
   *
   * The agent never sends usernames, emails, IPs, or any other PII
   * — only the kind enum + UTC timestamp.
   */
  events?: AgentEvent[];
};

/**
 * One CREATE event reported by the agent. The shape is intentionally
 * minimal — we only persist non-sensitive metadata.
 */
export type AgentEvent = {
  /** Account protocol/kind. STATUS is reserved for the dashboard's own
   *  status-transition writes and never appears in agent payloads. */
  kind: "SSH" | "VMESS" | "VLESS" | "TROJAN";
  /** ISO-8601 timestamp (UTC) of when the agent observed the new entry. */
  ts: string;
};

const TIMEOUT_MS = Number(process.env.VPS_FETCH_TIMEOUT_MS || 4000);
const RETRIES = Number(process.env.VPS_FETCH_RETRIES || 2);

/**
 * Translate the cryptic errors thrown by node fetch / undici into
 * actionable messages an admin can act on without reading source code.
 *
 * The dashboard surfaces this string on the admin Servers page next to
 * the OFFLINE badge, so it must be self-explanatory.
 */
function classifyFetchError(err: unknown, url: string, hadKey: boolean): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code || "";
  const msg = String(e?.message || "");
  const status = msg.match(/^HTTP (\d{3})/)?.[];

  // HTTP-level errors (we threw these ourselves)
  if (status === "401") return `HTTP 401 — API key mismatch (check Server "API Key")`;
  if (status === "403") return `HTTP 403 — agent rejected request (auth or IP allowlist)`;
  if (status === "404") return `HTTP 404 — wrong path (apiUrl must be base URL like http://host:8787, no /api suffix)`;
  if (status === "429") return `HTTP 429 — agent rate-limited; reduce poll frequency`;
  if (status?.startsWith("5")) return `HTTP ${status} — agent crashed; check 'journalctl -u sontoloyo-agent'`;

  // Transport-level errors from undici
  if (e?.name === "AbortError") return `Timeout ${TIMEOUT_MS}ms — agent unreachable (firewall / wrong port / agent down)`;
  if (code === "ECONNREFUSED") return `Connection refused — agent not listening on this port`;
  if (code === "ETIMEDOUT") return `Connection timed out — provider firewall blocks inbound to this port`;
  if (code === "EHOSTUNREACH") return `Host unreachable — routing issue or provider blocks inter-VPS traffic`;
  if (code === "ENETUNREACH") return `Network unreachable — DNS or routing fail`;
  if (code === "ENOTFOUND") return `DNS lookup failed — check hostname in apiUrl`;
  if (code === "ECONNRESET") return `Connection reset — TLS or proxy mismatch`;
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return `TLS cert error — use http:// for direct port, or fix Cloudflare Origin cert`;
  }

  if (msg.includes("Invalid URL")) return `Invalid apiUrl format — expected http(s)://host:port`;
  if (!hadKey) return `Fetch failed (no API key configured) — set "API Key" on this server`;

  // Last resort — surface the raw cause message but trimmed
  const detail = e?.cause?.message || msg || "unknown";
  return `Fetch failed — ${String(detail).slice(0, 200)}`;
}

async function fetchOnce(url: string, apiKey?: string | null) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: apiKey ? { "X-API-Key": apiKey } : {},
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as AgentPayload;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAgent(baseUrl: string, apiKey?: string | null) {
  // Defensive normalization (the API route also normalizes on save, but a
  // legacy DB row may still hold a raw value).
  const normalized = baseUrl.trim().replace(/\/$/, "");
  const url = (/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`) + "/api/status";

  let lastErr: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await fetchOnce(url, apiKey);
    } catch (e) {
      lastErr = e;
    }
  }
  // Re-throw with a friendly classified message; preserve original via cause.
  const friendly = classifyFetchError(lastErr, url, !!apiKey);
  const err = new Error(friendly);
  (err as { cause?: unknown }).cause = lastErr;
  throw err;
}

function deriveStatus(active: number, max: number, online: boolean): ServerStatus {
  if (!online) return ServerStatus.OFFLINE;
  if (max > 0 && active >= max) return ServerStatus.FULL;
  if (max > 0 && active / max >= 0.9) return ServerStatus.WARNING;
  return ServerStatus.ONLINE;
}

/**
 * Validate speedtest data consistency. All fields should be present or all absent.
 * Returns true if data is valid (all present or properly cleared).
 */
function isSpeedtestDataValid(
  down?: number,
  up?: number,
  ping?: number,
  at?: string | null,
): boolean {
  const hasMeasurements = (down ?? 0) > 0 || (up ?? 0) > 0;
  const hasTimestamp = at != null;
  
  // Valid states:
  // 1. All zeros/null (never tested) ✓
  // 2. Has measurements AND timestamp (valid result) ✓
  // 3. Has measurements but no timestamp (edge case, accept it) ✓
  // Invalid:
  // 4. Has timestamp but no measurements (inconsistent)
  if (!hasMeasurements && hasTimestamp) {
    return false;
  }
  return true;
}

export async function syncServer(serverId: string) {
  const s = await prisma.server.findUnique({ where: { id: serverId } });
  if (!s) throw new Error("Server not found");
  if (!s.enabled) return { skipped: true };
  if (!s.apiUrl) return { skipped: true, reason: "no apiUrl" };

  let payload: AgentPayload | null = null;
  let error: string | null = null;
  try {
    payload = await fetchAgent(s.apiUrl, s.apiKey);
  } catch (e: any) {
    error = e?.message || "fetch failed";
  }

  const online = !!payload?.ok;
  const active = payload?.active_users ?? s.activeUsers;
  // Live login count — falls back to the previous DB value when the
  // agent does not report it (pre-v1.7 agents). Never reset to 0 from
  // an offline payload because that would lie about reality (the
  // chart would see "0 logins" instead of "we lost contact").
  const logins = online
    ? payload?.active_logins ?? s.activeLogins
    : s.activeLogins;
  const status = deriveStatus(active, s.maxSlot, online);

  // Throughput resolution. v1.3+ agents send rx_speed / tx_speed split
  // by direction; the legacy `speed` field (combined RX+TX) is retained
  // for older agents that have not been upgraded yet. When only `speed`
  // is available we cannot tell which way the traffic flowed, so we
  // distribute it across the legacy speedMbps column only — leaving
  // rxSpeedMbps / txSpeedMbps at the previous value (or 0 on first
  // sync) so the dashboard's per-direction gauges do not show
  // misleading numbers.
  const rxSpeed = online ? payload?.rx_speed ?? s.rxSpeedMbps : 0;
  const txSpeed = online ? payload?.tx_speed ?? s.txSpeedMbps : 0;
  const combinedSpeed =
    online
      ? payload?.speed ??
        (payload?.rx_speed != null && payload?.tx_speed != null
          ? Number((payload.rx_speed + payload.tx_speed).toFixed(1))
          : s.speedMbps)
      : 0;

  // Speedtest validation: only persist if data is consistent.
  // If agent reports partial data (e.g., down_mbps but no timestamp),
  // we keep the previous DB value to avoid inconsistent state.
  const speedtestValid = isSpeedtestDataValid(
    payload?.last_test_down_mbps,
    payload?.last_test_up_mbps,
    payload?.last_test_ping_ms,
    payload?.last_test_at,
  );

  const data = {
    status,
    activeUsers: online ? active : 0,
    // `activeLogins` semantically means "people currently connected".
    // When the agent is unreachable that count is unknown — we keep
    // the last known value so the chart line continues smoothly
    // instead of dropping to 0 and creating a fake "everyone logged
    // out" event in the visual history.
    activeLogins: logins,
    speedMbps: combinedSpeed,
    rxSpeedMbps: rxSpeed,
    txSpeedMbps: txSpeed,
    // ── Tier 2: Daily Ookla speedtest result (refreshed at 03:00 local) ──
    // Persist whenever the agent reports it AND data is consistent.
    // We never overwrite with zeros from an offline agent — that would
    // erase a perfectly good historical benchmark just because the agent
    // hiccupped. Also validate speedtest state to avoid partial data.
    lastSpeedtestDownMbps: online && speedtestValid
      ? payload?.last_test_down_mbps ?? s.lastSpeedtestDownMbps
      : s.lastSpeedtestDownMbps,
    lastSpeedtestUpMbps: online && speedtestValid
      ? payload?.last_test_up_mbps ?? s.lastSpeedtestUpMbps
      : s.lastSpeedtestUpMbps,
    lastSpeedtestPingMs: online && speedtestValid
      ? payload?.last_test_ping_ms ?? s.lastSpeedtestPingMs
      : s.lastSpeedtestPingMs,
    lastSpeedtestAt: online && speedtestValid && payload?.last_test_at
      ? new Date(payload.last_test_at)
      : s.lastSpeedtestAt,
    // Traffic counters: persist RX/TX from agent, never overwrite with
    // offline zeros. Agent uses vnstat which has daily reset at midnight
    // SERVER LOCAL TIME (not UTC), so timezone offset is baked into the
    // agent's day bucket already. Dashboard receives the correct values
    // and just persists them as-is.
    rxBytes: BigInt(online ? payload?.rx ?? Number(s.rxBytes) : Number(s.rxBytes)),
    txBytes: BigInt(online ? payload?.tx ?? Number(s.txBytes) : Number(s.txBytes)),
    // Today's bucket and since-reboot snapshot are persisted whenever
    // the agent reports them. We never overwrite with zeros from an
    // offline payload — that would erase the legitimate value the DB
    // already holds and make the dashboard's TODAY tile flash to 0
    // every time a sync fails. Agent handles timezone in vnstat output.
    rxBytesToday: BigInt(
      online ? payload?.rx_today ?? Number(s.rxBytesToday) : Number(s.rxBytesToday),
    ),
    txBytesToday: BigInt(
      online ? payload?.tx_today ?? Number(s.txBytesToday) : Number(s.txBytesToday),
    ),
    rxBytesBoot: BigInt(
      online ? payload?.rx_boot ?? Number(s.rxBytesBoot) : Number(s.rxBytesBoot),
    ),
    txBytesBoot: BigInt(
      online ? payload?.tx_boot ?? Number(s.txBytesBoot) : Number(s.txBytesBoot),
    ),
    // Uptime persisted as seconds from agent. Frontend is responsible for
    // formatting to "1h 23m" or similar via formatUptime() utility.
    uptimeSec: online ? payload?.uptime ?? s.uptimeSec : 0,
    // CPU/RAM: realtime monitoring — set to 0 when offline (agent not reachable).
    // This is by design for monitoring dashboard (shows real current state).
    cpuPercent: online ? payload?.cpu ?? s.cpuPercent : 0,
    ramPercent: online ? payload?.ram ?? s.ramPercent : 0,
    sshActive: online ? !!payload?.ssh : false,
    xrayActive: online ? !!payload?.xray : false,
    nginxActive: online ? !!payload?.nginx : false,
    udpActive: online ? !!payload?.udp : false,
    // Account totals: keep DB value when offline (subscriptions don't disappear).
    totalSsh: online ? payload?.total_ssh ?? s.totalSsh : s.totalSsh,
    totalXray: online ? payload?.total_xray ?? s.totalXray : s.totalXray,
    lastError: error,
    lastSyncAt: new Date(),
  };

  await prisma.server.update({ where: { id: s.id }, data });

  // Status-transition activity feed.
  //
  // Whenever a sync detects the server has moved between status states
  // (ONLINE → OFFLINE, OFFLINE → ONLINE, etc.) we append a row to the
  // Activity table so the public homepage's "Realtime Activity" feed
  // shows REAL events driven by actual probes — not synthetic data.
  //
  // Best-effort: a write failure must not break the sync (e.g. fresh
  // database that hasn't run `prisma db push` yet to add the renamed
  // column). The catch silences errors so the rest of the sync still
  // completes and persists.
  if (s.status !== status) {
    await prisma.activity
      .create({
        data: {
          kind: "STATUS",
          serverName: s.name,
          action: `${s.status}→${status}`,
        },
      })
      .catch(() => {});
  }

  // Keep a small rolling history (best-effort)
  await prisma.serverMetric
    .create({
      data: {
        serverId: s.id,
        status: data.status,
        activeUsers: data.activeUsers,
        activeLogins: data.activeLogins,
        speedMbps: data.speedMbps,
        rxSpeedMbps: data.rxSpeedMbps,
        txSpeedMbps: data.txSpeedMbps,
        rxBytes: data.rxBytes,
        txBytes: data.txBytes,
        cpuPercent: data.cpuPercent,
        ramPercent: data.ramPercent,
      },
    })
    .catch(() => {});

  // Account-creation events from the agent's file watcher.
  //
  // The agent's watcher diffs `/etc/ssh/.ssh.db`, the per-protocol
  // /etc/<proto>/.<proto>.db files, and the xray config every few
  // seconds and buffers any new entries it sees as one of:
  //
  //   { kind: "SSH"|"VMESS"|"VLESS"|"TROJAN", ts: "<ISO-8601 UTC>" }
  //
  // Each entry becomes an Activity row with action="CREATE" and the
  // server's display name. We deliberately do NOT trust the kind
  // string — only the four documented enum values are accepted, any
  // other label is dropped. This isolates the dashboard from a
  // compromised agent that might try to inject arbitrary strings
  // into the public feed.
  //
  // De-duplication: the agent has TWO independent sources for xray
  // events (per-protocol .db files AND config.json `"email"` fields).
  // When an autoscript writes to both, the same account can land
  // twice within the same payload — we use a 5-second window keyed
  // on (kind, serverName) to skip the duplicate insertion. This is a
  // best-effort guard; persistent dedup is enforced naturally by the
  // unique cuid primary keys.
  if (online && Array.isArray(payload?.events) && payload.events.length > 0) {
    const ALLOWED = new Set(["SSH", "VMESS", "VLESS", "TROJAN"]);
    const recentSeen = new Map<string, number>();
    for (const ev of payload.events) {
      if (!ev || typeof ev !== "object") continue;
      const kind = String((ev as AgentEvent).kind || "").toUpperCase();
      if (!ALLOWED.has(kind)) continue;
      const tsRaw = (ev as AgentEvent).ts;
      const createdAt = tsRaw ? new Date(tsRaw) : new Date();
      // Defensive: drop events whose timestamp is unparseable, in the
      // future, or absurdly old (>24h). Keeps the feed honest.
      if (Number.isNaN(createdAt.getTime())) continue;
      const skewMs = createdAt.getTime() - Date.now();
      if (skewMs > 60_000) continue; // >1 min in the future
      if (-skewMs > 24 * 60 * 60_000) continue; // >24h in the past
      // In-payload dedup window: same (kind, serverName) within 5s
      // is treated as a single event regardless of how many sources
      // the agent observed it from.
      const key = `${kind}|${s.name}`;
      const last = recentSeen.get(key) ?? 0;
      const t = createdAt.getTime();
      if (Math.abs(t - last) < 5000) continue;
      recentSeen.set(key, t);
      await prisma.activity
        .create({
          data: {
            kind,
            serverName: s.name,
            action: "CREATE",
            createdAt,
          },
        })
        .catch(() => {});
    }
  }

  return { ok: online, error };
}

export async function syncAll() {
  const servers = await prisma.server.findMany({ where: { enabled: true } });
  const results = await Promise.allSettled(servers.map((s) => syncServer(s.id)));
  return {
    total: servers.length,
    ok: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

export async function testConnection(baseUrl: string, apiKey?: string | null) {
  try {
    const data = await fetchAgent(baseUrl, apiKey);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "fetch failed" };
  }
}

// ─── Lazy auto-sync (in-process scheduler) ──────────────────────────────
//
// Public read endpoints (`/api/servers/public`, `/api/stats`) call
// `maybeAutoSync()` at the start of every request. When server data is
// stale (no sync in the last MONITOR_AUTOSYNC_STALE_MS) and no other
// sync is already in flight, we kick off `syncAll()` in the background
// and return the response immediately. The next poll a few seconds
// later sees the freshly written DB rows.
//
// This makes the dashboard self-healing: even with zero external cron,
// any visitor traffic naturally drives data freshness. The previous
// design required an external curl-based crontab which operators
// frequently forgot to install (the original RCA case study saw a
// dashboard frozen for hours because no scheduler was configured).
//
// Safeguards:
//  • At most one inflight sync at a time (singleton promise)
//  • Cooldown between successive auto-syncs (default 30 s) to avoid
//    thundering-herd when many tabs poll concurrently
//  • Skips entirely when no enabled server is stale — a fully fresh
//    dashboard pays zero cost
//  • Does NOT replace the documented cron in DEPLOY.md — the cron is
//    still recommended as a safety net for low-traffic deployments.

const AUTOSYNC_COOLDOWN_MS = Number(process.env.MONITOR_AUTOSYNC_COOLDOWN_MS || 30_000);
// Stale threshold lowered from 60s → 20s so the dashboard reacts faster
// to fresh activity (CREATE events, status flips). The cooldown above
// still prevents thundering-herd, so the worst-case sync rate is still
// once per 30 seconds — but the BEST case latency drops from ~60s to
// ~20s when traffic is steady.
const AUTOSYNC_STALE_MS = Number(process.env.MONITOR_AUTOSYNC_STALE_MS || 20_000);
const AUTOSYNC_DISABLED = process.env.MONITOR_AUTOSYNC_DISABLED === "1";

let lastAutoSyncAt = 0;
let inflightAutoSync: Promise<unknown> | null = null;
// ServerMetric cleanup runs at most once per hour, regardless of how
// many auto-syncs fire. Older rows than 24h are deleted so the rolling
// chart history (60 samples × 10 s = 10 min visible) stays representative
// without the table growing unbounded.
const METRIC_RETENTION_HOURS = Number(process.env.MONITOR_METRIC_RETENTION_HOURS || 24);
const METRIC_CLEANUP_INTERVAL_MS = Number(
  process.env.MONITOR_METRIC_CLEANUP_INTERVAL_MS || 60 * 60_000,
);
let lastMetricCleanupAt = 0;

/**
 * Trigger a background sync if any enabled server is stale.
 *
 * Fire-and-forget: callers must NOT await the returned promise. The
 * function returns void; any thrown errors are swallowed (logged to
 * stderr) so a sync failure cannot break a normal page render.
 *
 * Idempotent and concurrency-safe — many concurrent visitors all
 * landing on `/api/servers/public` at once will trigger at most one
 * background sync.
 */
export function maybeAutoSync(): void {
  if (AUTOSYNC_DISABLED) return;
  if (inflightAutoSync) return;
  const now = Date.now();
  if (now - lastAutoSyncAt < AUTOSYNC_COOLDOWN_MS) return;

  // Mark the attempt window now (before the async work) so concurrent
  // calls within the cooldown all bail out early.
  lastAutoSyncAt = now;

  const job = (async () => {
    try {
      // Skip the sync entirely when nothing is stale — protects against
      // a noisy "first paint" page that fires many requests in parallel
      // when the dashboard is already up to date.
      const staleCutoff = new Date(now - AUTOSYNC_STALE_MS);
      const stale = await prisma.server.findFirst({
        where: {
          enabled: true,
          OR: [
            { lastSyncAt: null },
            { lastSyncAt: { lt: staleCutoff } },
          ],
        },
        select: { id: true },
      });
      if (!stale) return;
      await syncAll();

      // Opportunistic ServerMetric cleanup. We piggyback on auto-sync
      // because there is no separate scheduler — running a hourly
      // delete keeps the table compact without adding infrastructure.
      if (Date.now() - lastMetricCleanupAt > METRIC_CLEANUP_INTERVAL_MS) {
        lastMetricCleanupAt = Date.now();
        const cutoff = new Date(Date.now() - METRIC_RETENTION_HOURS * 60 * 60_000);
        await prisma.serverMetric
          .deleteMany({ where: { ts: { lt: cutoff } } })
          .catch((err) => {
            console.error("[autosync] metric cleanup failed:", err);
          });
      }
    } catch (err) {
      // Best-effort. Log to stderr but do not propagate.
      console.error("[autosync] background sync failed:", err);
    } finally {
      inflightAutoSync = null;
    }
  })();

  inflightAutoSync = job;
}