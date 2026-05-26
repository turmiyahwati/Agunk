import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeServers } from "@/lib/serialize";
import { sanitizeDomain } from "@/lib/sanitize";

/**
 * Public, sanitized server list. No auth required.
 * - apiUrl, apiKey, lastError, refreshMs are NEVER selected
 * - private/internal IPs in `domain` are masked
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const servers = await prisma.server.findMany({
    where: { enabled: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, domain: true, country: true, countryName: true,
      flag: true, provider: true, maxSlot: true, status: true, activeUsers: true,
      pingMs: true, speedMbps: true, rxBytes: true, txBytes: true, uptimeSec: true,
      cpuPercent: true, ramPercent: true, sshActive: true, xrayActive: true,
      nginxActive: true, udpActive: true, totalSsh: true, totalXray: true,
      lastSyncAt: true,
    },
  });

  const sanitized = serializeServers(servers).map((s) => ({
    ...s,
    domain: sanitizeDomain(s.domain),
  }));

  return NextResponse.json({ servers: sanitized });
}
