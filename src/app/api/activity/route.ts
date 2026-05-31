import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * Public read of recent activity events.
 *
 * Two sources populate this feed in production:
 *   1. INTERNAL — the monitor sync layer writes a row whenever a
 *      server's status changes (e.g. ONLINE → OFFLINE). These are
 *      the events visitors see by default — driven by REAL probes
 *      against each monitored VPS. See `lib/monitor.ts → syncServer`.
 *   2. EXTERNAL — operator order systems may POST to this endpoint
 *      after a VPN account is created. Optional integration retained
 *      for backward compatibility.
 *
 * Only safe metadata is exposed: kind, server name, action, and
 * timestamp. Usernames, passwords, UUIDs, IPs, tokens, and any other
 * credential are NEVER stored in this table.
 *
 * Both endpoints are IP-rate-limited.
 *
 * Daily reset: the GET response only includes events from "today" in
 * Asia/Jakarta (WIB, UTC+7). At local midnight the visible feed
 * automatically empties even though the underlying rows remain in the
 * DB for downstream audit / analytics. We chose this filter-at-read
 * approach over a delete-scheduled-job because:
 *  • Reset is instantaneous at midnight (no cron drift / window).
 *  • Cleanup logic stays out of the request hot path.
 *  • Historic rows are still queryable for incident review.
 */
export const dynamic = "force-dynamic";

// Accepted `kind` values:
//   STATUS                       — internal status-transition event
//   SSH | VMESS | VLESS | TROJAN — external VPN-account-creation event
const KINDS = ["STATUS", "SSH", "VMESS", "VLESS", "TROJAN"] as const;

const createSchema = z.object({
  // `kind` is the canonical name; `protocol` is accepted as an alias so
  // existing external integrations that POST { protocol: "VMESS", ... }
  // keep working without code changes on their side.
  kind: z.enum(KINDS).optional(),
  protocol: z.enum(KINDS).optional(),
  serverName: z.string().trim().min(1).max(80),
  action: z.string().trim().min(1).max(40).default("CREATE"),
});

/**
 * Returns the UTC instant that corresponds to today's midnight in
 * Asia/Jakarta (WIB, UTC+7). Used as the lower bound of the daily
 * activity feed.
 *
 *   WIB midnight  =  UTC 17:00 of the previous calendar day
 *
 * We compute it via string formatting against the IANA tz database so
 * the value stays correct year-round (Indonesia does not currently
 * observe DST, but this future-proofs the math against any tz change).
 */
function startOfTodayWIB(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gives us "YYYY-MM-DD" directly.
  const ymd = fmt.format(now);
  return new Date(`${ymd}T00:00:00+07:00`);
}

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 12)));

  try {
    const rows = await prisma.activity.findMany({
      where: { createdAt: { gte: startOfTodayWIB() } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        kind: true,
        serverName: true,
        action: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      activities: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        serverName: r.serverName,
        action: r.action,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch {
    // If the table does not yet exist (forgot to migrate), return empty.
    return NextResponse.json({ activities: [] });
  }
}

/**
 * Admin-only ingest. Designed to be called from the operator's order
 * system after a VPN account is created. Strict allowlist on kind +
 * action; any other field in the body is ignored.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const parsed = createSchema.parse(await req.json());
    const kind = parsed.kind ?? parsed.protocol;
    if (!kind) {
      return NextResponse.json(
        { error: "kind (or protocol) is required" },
        { status: 400 },
      );
    }
    const created = await prisma.activity.create({
      data: { kind, serverName: parsed.serverName, action: parsed.action },
      select: { id: true, kind: true, serverName: true, action: true, createdAt: true },
    });
    return NextResponse.json(
      {
        activity: { ...created, createdAt: created.createdAt.toISOString() },
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
