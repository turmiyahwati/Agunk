import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public read-only metrics history. Powers the realtime chart on
 * /servers/[id]. No auth required.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") || 60));

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
      pingMs: m.pingMs,
      speedMbps: m.speedMbps,
      rxBytes: Number(m.rxBytes),
      txBytes: Number(m.txBytes),
      cpuPercent: m.cpuPercent,
      ramPercent: m.ramPercent,
      status: m.status,
    }))
    .reverse();
  return NextResponse.json({ metrics: out });
}
