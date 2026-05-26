import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public aggregate counters. No auth required.
 * Used by both the public homepage and the admin overview.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [total, online, offline, full, warning, agg] = await Promise.all([
    prisma.server.count({ where: { enabled: true } }),
    prisma.server.count({ where: { status: "ONLINE", enabled: true } }),
    prisma.server.count({ where: { status: "OFFLINE", enabled: true } }),
    prisma.server.count({ where: { status: "FULL", enabled: true } }),
    prisma.server.count({ where: { status: "WARNING", enabled: true } }),
    prisma.server.aggregate({
      where: { enabled: true },
      _sum: { activeUsers: true, maxSlot: true },
    }),
  ]);

  return NextResponse.json({
    servers: { total, online, offline, full, warning },
    connections: {
      active: agg._sum.activeUsers ?? 0,
      capacity: agg._sum.maxSlot ?? 0,
    },
  });
}
