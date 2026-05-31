import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, PUBLIC_API_LIMIT } from "@/lib/rate-limit";

/**
 * Public read-only metrics history. Powers the realtime chart on
 * /servers/[id]. No auth required, rate-limited per IP.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 60)));

  // Only return metrics for enabled servers (defense-in-depth).
  const server = await prisma.server.findUnique({
    where: { id: params.id },
    select: { enabled: true },
  });
  if (!server || !server.enabled) {
    return NextResponse.json({ metrics: [] });
  }

  const metrics = await prisma.serverMetric.findMany({
    where: { serverId: params.id },
    orderBy: { ts: "desc" },
    take: limit,
  });

  const out = metrics
    .map((m) => ({
      ts: m.ts.toISOString(),
      activeUsers: m.activeUsers,
      activeLogins: m.activeLogins,
      speedMbps: m.speedMbps,
      rxSpeedMbps: m.rxSpeedMbps,
      txSpeedMbps: m.txSpeedMbps,
      rxBytes: Number(m.rxBytes),
      txBytes: Number(m.txBytes),
      cpuPercent: m.cpuPercent,
      ramPercent: m.ramPercent,
      status: m.status,
    }))
    .reverse();
  return NextResponse.json({ metrics: out });
}
