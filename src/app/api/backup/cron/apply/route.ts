import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";
import { getBackupConfig } from "@/lib/backup-config";
import { applyCron, getCronPath } from "@/lib/cron-config";

/**
 * POST /api/backup/cron/apply
 *
 * Renders `/etc/cron.d/sontoloyo` from the current backup config +
 * environment (MONITOR_SYNC_TOKEN, NEXTAUTH_URL, INSTALL_DIR) and
 * reloads cron. Idempotent — calling it twice in a row is a no-op.
 *
 * Returns the rendered file content even on partial failure so the
 * admin UI can show the operator exactly what would have been written
 * (useful for debugging permission errors in dev).
 *
 * Requires admin session + WRITE_LIMIT rate limit.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const cfg = await getBackupConfig();

  // Pre-flight: surface missing required env vars before we attempt
  // to write anything. This is the most common cause of "why did my
  // cron break?" in production — operator forgot to set the token.
  const missing: string[] = [];
  const syncToken = process.env.MONITOR_SYNC_TOKEN || "";
  if (!syncToken) missing.push("MONITOR_SYNC_TOKEN");

  // NEXTAUTH_URL is the canonical source of the public hostname
  // (used by the Next.js auth layer too). Fall back to a request-derived
  // origin so a partially-configured dev box still gets a valid file.
  const url = process.env.NEXTAUTH_URL || req.headers.get("origin") || "";
  let domain = "";
  if (url) {
    try {
      domain = new URL(url).host;
    } catch {
      domain = "";
    }
  }
  if (!domain) missing.push("NEXTAUTH_URL");

  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Missing required env: ${missing.join(", ")}`,
        path: getCronPath(),
        content: "",
        written: false,
        reloaded: false,
        cadence: "",
      },
      { status: 400 },
    );
  }

  const installDir = process.env.SONTOLOYO_INSTALL_DIR || process.cwd();
  const result = await applyCron({
    domain,
    syncToken,
    installDir,
    intervalHours: cfg.intervalHours,
  });

  // We always return 200 on a "rendered but not written" outcome too —
  // the caller wants to display the rendered cron content and the
  // precise reason it couldn't be applied.
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}
