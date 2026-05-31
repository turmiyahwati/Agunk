import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, PUBLIC_API_LIMIT } from "@/lib/rate-limit";
import { maybeAutoSync } from "@/lib/monitor";

/**
 * Public aggregate counters. No auth required.
 * Used by both the public homepage and the admin overview.
 * Rate-limited per IP.
 *
 * Also acts as a freshness driver — visitor traffic on this endpoint
 * triggers a background `syncAll()` when server data is stale (see
 * `lib/monitor.ts → maybeAutoSync` for the throttle/cooldown rules).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  // Fire-and-forget — keeps the dashboard self-healing even when the
  // operator hasn't installed the recommended external curl-based cron.
  maybeAutoSync();

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

  return NextResponse.json(
    {
      servers: { total, online, offline, full, warning },
      connections: {
        active: agg._sum.activeUsers ?? 0,
        capacity: agg._sum.maxSlot ?? 0,
      },
    },
    {
      // 2 s edge/browser cache + 8 s stale-while-revalidate. Visitors
      // who spam-refresh see the cached counters instead of pummeling
      // the DB; legitimate background polling still gets fresh data
      // every 10 s.
      headers: {
        "Cache-Control": "public, max-age=2, stale-while-revalidate=8",
      },
    },
  );
}
