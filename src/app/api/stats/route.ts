import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [total, online, offline, full, warning, agg] = await Promise.all([
    prisma.server.count(),
    prisma.server.count({ where: { status: "ONLINE" } }),
    prisma.server.count({ where: { status: "OFFLINE" } }),
    prisma.server.count({ where: { status: "FULL" } }),
    prisma.server.count({ where: { status: "WARNING" } }),
    prisma.server.aggregate({
      _sum: { activeUsers: true, maxSlot: true },
    }),
  ]);

  const totalUsers = await prisma.user.count();

  return NextResponse.json({
    servers: { total, online, offline, full, warning },
    users: {
      activeOnVPN: agg._sum.activeUsers ?? 0,
      totalSlot: agg._sum.maxSlot ?? 0,
      members: totalUsers,
    },
  });
}
