import { NextResponse } from "next/server";
import { listBackups } from "@/lib/backup";
import { getBackupConfig } from "@/lib/backup-config";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, PUBLIC_API_LIMIT } from "@/lib/rate-limit";

/**
 * GET /api/backup
 *
 * Returns the current backup configuration + a paginated list of
 * backups on disk. Admin-only — backup metadata reveals server
 * names and timing patterns that are not safe for public
 * consumption.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [config, backups] = await Promise.all([getBackupConfig(), listBackups()]);
  return NextResponse.json({ config, backups });
}
