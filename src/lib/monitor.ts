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
  const url = baseUrl.replace(/\/$/, "") + "/api/status";
  let lastErr: any;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await fetchOnce(url, apiKey);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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
