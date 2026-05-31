import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_BACKUP_CONFIG,
  getBackupConfig,
  updateBackupConfig,
} from "@/lib/backup-config";
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
    const cfg = await updateBackupConfig(rest, { passphrase, smtpPass });
    return NextResponse.json({ config: cfg });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 400 });
  }
}
