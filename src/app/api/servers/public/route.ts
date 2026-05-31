import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeServers } from "@/lib/serialize";
import { enforceRateLimit, PUBLIC_API_LIMIT } from "@/lib/rate-limit";
import { maybeAutoSync } from "@/lib/monitor";

/**
 * Public, sanitized server list. No auth required.
 *
 * Security notes:
 *  - Sensitive infrastructure fields (apiUrl, apiKey, lastError, refreshMs)
 *    are NEVER selected from the database.
 *  - The `domain` field is stripped to an empty string for the public
 *    response so visitors can NOT enumerate the real hostname / IP /
 *    panel URL of any monitored VPS. Admins still get the full record
 *    via the authenticated /api/servers endpoint.
 *  - Rate-limited per IP to prevent scraping / abuse.
 *
 * Freshness: this endpoint also triggers a background `syncAll()` when
 * any monitored server's `lastSyncAt` is older than 60 s, making the
 * dashboard self-healing without requiring an external cron. See
 * `lib/monitor.ts → maybeAutoSync` for the full guard logic.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  // Fire-and-forget — does NOT block the response. The next poll a few
  // seconds later picks up the freshly synced rows from the DB.
  maybeAutoSync();

  const servers = await prisma.server.findMany({
    where: { enabled: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, country: true, countryName: true,
      flag: true, provider: true, maxSlot: true, status: true, activeUsers: true,
      activeLogins: true,
      speedMbps: true,
      rxSpeedMbps: true, txSpeedMbps: true,
      lastSpeedtestDownMbps: true,
      lastSpeedtestUpMbps: true,
      lastSpeedtestPingMs: true,
      lastSpeedtestAt: true,
      rxBytes: true, txBytes: true,
      rxBytesToday: true, txBytesToday: true,
      rxBytesBoot: true, txBytesBoot: true,
      uptimeSec: true,
      cpuPercent: true, ramPercent: true, sshActive: true, xrayActive: true,
      nginxActive: true, udpActive: true, totalSsh: true, totalXray: true,
      lastSyncAt: true,
    },
  });

  // Public payload never carries the real domain. Admins keep full visibility
  // through the authenticated endpoint; the public detail page treats an
  // empty `domain` string as "hidden" and skips rendering that line.
  const sanitized = serializeServers(servers).map((s) => ({
    ...s,
    domain: "",
  }));

  return NextResponse.json({ servers: sanitized });
}
