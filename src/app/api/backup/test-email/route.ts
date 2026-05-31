import { NextResponse } from "next/server";
import { sendTestEmail } from "@/lib/email";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/backup/test-email
 *
 * Send a small "hello from your dashboard" message to validate SMTP
 * credentials before relying on them for backup delivery. Rate-limited
 * to discourage operators from accidentally hammering Gmail (which
 * caps SMTP at ~500/day on free accounts).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await sendTestEmail();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
