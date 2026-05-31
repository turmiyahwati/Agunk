import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_BACKUP_CONFIG,
  getBackupConfig,
  updateBackupConfig,
} from "@/lib/backup-config";
import { applyCron, getCronPath, type CronApplyResult } from "@/lib/cron-config";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * GET / PATCH /api/backup/settings
 *
 * Admin-managed runtime configuration for the Backup & Recovery panel.
 * GET is rate-limited under PUBLIC_API_LIMIT (admin polls the page),
 * PATCH under WRITE_LIMIT (writes are rare).
 *
 * Sensitive fields:
 *   • passphrase  — write-only; we never echo it back.
 *                   Pass null/empty to clear.
 *   • smtpPass    — same semantics.
 *
 * Cron auto-rewrite:
 *   When `intervalHours` changes, we attempt to rewrite
 *   /etc/cron.d/sontoloyo so the OS-level backup schedule actually
 *   reflects the new cadence. The attempt is best-effort and never
 *   fails the PATCH — the resulting `cron` field on the response
 *   tells the UI whether the cron file was rewritten + reloaded
 *   (success), written but not reloaded (warning), or skipped
 *   (no permission / non-Linux dev / interval unchanged).
 */
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  intervalHours: z.number().int().refine((n) => [1, 3, 6, 12, 24].includes(n), {
    message: "intervalHours must be one of 1, 3, 6, 12, 24",
  }).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  emailEnabled: z.boolean().optional(),
  emailRecipient: z.string().email().or(z.literal("")).optional(),
  smtpHost: z.string().min(1).max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(200).optional(),
  sendAfterBackup: z.boolean().optional(),
  // Sensitive — null clears, empty string also clears, undefined leaves untouched.
  passphrase: z.string().max(256).nullable().optional(),
  smtpPass: z.string().max(256).nullable().optional(),
});

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const cfg = await getBackupConfig();
  return NextResponse.json({ config: cfg, defaults: DEFAULT_BACKUP_CONFIG });
}

export async function PATCH(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const body = patchSchema.parse(await req.json());
    const { passphrase, smtpPass, ...rest } = body;

    // Snapshot the previous interval so we can detect a real change
    // and only touch /etc/cron.d when it actually shifted. This keeps
    // PATCHes that only edit SMTP / retention / email from rewriting
    // cron unnecessarily.
    const before = await getBackupConfig();
    const cfg = await updateBackupConfig(rest, { passphrase, smtpPass });

    let cron: CronAutoApply | null = null;
    if (cfg.intervalHours !== before.intervalHours) {
      cron = await tryAutoApplyCron(req, cfg.intervalHours);
    }

    return NextResponse.json({ config: cfg, cron });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 400 });
  }
}

// ─── Cron auto-apply helper ───────────────────────────────────────────────

type CronAutoApply =
  | { attempted: true; result: CronApplyResult }
  | {
      attempted: false;
      reason: string;
      path: string;
    };

/**
 * Attempt to rewrite /etc/cron.d/sontoloyo when the interval changes.
 *
 * Soft-fails:
 *   - Missing MONITOR_SYNC_TOKEN or NEXTAUTH_URL → returns
 *     { attempted: false, reason } so the UI can hint the operator
 *     to set them rather than silently skipping.
 *   - Linux/permission errors are surfaced via the underlying
 *     applyCron() result.
 *
 * Never throws — backup-settings PATCH must succeed even if the
 * dashboard process can't write to /etc.
 */
async function tryAutoApplyCron(
  req: Request,
  intervalHours: number,
): Promise<CronAutoApply> {
  const syncToken = process.env.MONITOR_SYNC_TOKEN || "";
  const url = process.env.NEXTAUTH_URL || req.headers.get("origin") || "";
  let domain = "";
  if (url) {
    try {
      domain = new URL(url).host;
    } catch {
      domain = "";
    }
  }

  const missing: string[] = [];
  if (!syncToken) missing.push("MONITOR_SYNC_TOKEN");
  if (!domain) missing.push("NEXTAUTH_URL");
  if (missing.length > 0) {
    return {
      attempted: false,
      reason: `cron auto-apply skipped — missing env: ${missing.join(", ")}`,
      path: getCronPath(),
    };
  }

  const installDir = process.env.SONTOLOYO_INSTALL_DIR || process.cwd();
  try {
    const result = await applyCron({
      domain,
      syncToken,
      installDir,
      intervalHours,
    });
    return { attempted: true, result };
  } catch (err) {
    // applyCron itself doesn't throw, but defense-in-depth: if some
    // unexpected error sneaks out, swallow it and report as not-attempted
    // so the PATCH response stays well-formed.
    return {
      attempted: false,
      reason: `cron auto-apply error: ${(err as Error).message}`,
      path: getCronPath(),
    };
  }
}
