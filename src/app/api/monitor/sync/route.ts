import { NextResponse } from "next/server";
import { syncAll } from "@/lib/monitor";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, SYNC_LIMIT } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Two ways to trigger:
// 1) ADMIN session  → manual "Sync now" button in admin panel
// 2) X-Sync-Token header matching MONITOR_SYNC_TOKEN  → external cron (curl)
export async function POST(req: Request) {
  // Tight per-IP rate limit prevents runaway curl loops + brute scrapes.
  const limited = enforceRateLimit(req, SYNC_LIMIT);
  if (limited) return limited;

  const token = req.headers.get("x-sync-token");
  const allowToken =
    !!process.env.MONITOR_SYNC_TOKEN && token === process.env.MONITOR_SYNC_TOKEN;

  if (!allowToken) {
    const auth = await requireAdmin();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await syncAll();
    return NextResponse.json({ ...result, success: true, ts: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
