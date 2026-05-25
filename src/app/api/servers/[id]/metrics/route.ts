import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") || 60));
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
