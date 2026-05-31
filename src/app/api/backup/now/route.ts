import { NextResponse } from "next/server";
import { runBackupAndOptionallyEmail } from "@/lib/backup";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/backup/now
 *
 * Trigger a fresh backup on demand. Spawns scripts/backup-all.sh
 * synchronously (the script itself takes ~1-2 seconds for typical
 * databases). Falls under WRITE_LIMIT to discourage abusive clicks
 * — operators that need a flurry of backups should use the cron
 * schedule instead.
 *
 * Body (JSON, optional):
 *   { "email": true | false }   override config's send_after_backup
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let forceEmail = false;
  try {
    const body = await req.json();
    if (typeof body?.email === "boolean") forceEmail = body.email;
  } catch {
    // empty body is fine
  }

  try {
    const result = await runBackupAndOptionallyEmail({ source: "manual", forceEmail });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Backup script failed", output: result.output },
        { status: 500 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
