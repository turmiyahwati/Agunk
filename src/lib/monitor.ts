import { prisma } from "./prisma";
import { ServerStatus } from "./enums";

export type AgentPayload = {
  ok: boolean;
  uptime?: number;
  cpu?: number;
  ram?: number;
  ping?: number;
  speed?: number;
  rx?: number;
  tx?: number;
  active_users?: number;
  ssh?: boolean;
  xray?: boolean;
  nginx?: boolean;
  udp?: boolean;
  total_ssh?: number;
  total_xray?: number;
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
  const status = msg.match(/^HTTP (\d{3})/)?.[1];

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
  const status = deriveStatus(active, s.maxSlot, online);

  const data = {
    status,
    activeUsers: online ? active : 0,
    pingMs: online ? payload?.ping ?? s.pingMs : 0,
    speedMbps: online ? payload?.speed ?? s.speedMbps : 0,
    rxBytes: BigInt(online ? payload?.rx ?? Number(s.rxBytes) : Number(s.rxBytes)),
    txBytes: BigInt(online ? payload?.tx ?? Number(s.txBytes) : Number(s.txBytes)),
    uptimeSec: online ? payload?.uptime ?? s.uptimeSec : 0,
    cpuPercent: online ? payload?.cpu ?? s.cpuPercent : 0,
    ramPercent: online ? payload?.ram ?? s.ramPercent : 0,
    sshActive: online ? !!payload?.ssh : false,
    xrayActive: online ? !!payload?.xray : false,
    nginxActive: online ? !!payload?.nginx : false,
    udpActive: online ? !!payload?.udp : false,
    totalSsh: online ? payload?.total_ssh ?? s.totalSsh : s.totalSsh,
    totalXray: online ? payload?.total_xray ?? s.totalXray : s.totalXray,
    lastError: error,
    lastSyncAt: new Date(),
  };

  await prisma.server.update({ where: { id: s.id }, data });

  // Keep a small rolling history (best-effort)
  await prisma.serverMetric
    .create({
      data: {
        serverId: s.id,
        status: data.status,
        activeUsers: data.activeUsers,
        pingMs: data.pingMs,
        speedMbps: data.speedMbps,
        rxBytes: data.rxBytes,
        txBytes: data.txBytes,
        cpuPercent: data.cpuPercent,
        ramPercent: data.ramPercent,
      },
    })
    .catch(() => {});

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
