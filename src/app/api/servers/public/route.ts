import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeServers } from "@/lib/serialize";

// Public-ish: returns sanitized server data for member dashboard.
// Requires login (any role) — credentials/api keys are NEVER returned.
import { requireUser } from "@/lib/guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const servers = await prisma.server.findMany({
    where: { enabled: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    // Public/member view: NEVER expose domain/IP, agent base URL, or API key.
    // Admin endpoints (/api/servers, /api/servers/:id) return those for admins only.
    select: {
      id: true, name: true, country: true, countryName: true,
      flag: true, provider: true, maxSlot: true, status: true, activeUsers: true,
      pingMs: true, speedMbps: true, rxBytes: true, txBytes: true, uptimeSec: true,
      cpuPercent: true, ramPercent: true, sshActive: true, xrayActive: true,
      nginxActive: true, udpActive: true, totalSsh: true, totalXray: true,
      lastSyncAt: true,
    },
  });
  return NextResponse.json({ servers: serializeServers(servers) });
}
