import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { resolveBackupPath, computeSha256 } from "@/lib/backup";
import { sendBackupEmail } from "@/lib/email";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/backup/[name]/email
 *
 * Re-send an existing backup file via the configured SMTP profile.
 * Useful when the original delivery bounced or admin wants a copy
 * in a different inbox.
 */
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { name: string } },
) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let full: string;
  try {
    full = resolveBackupPath(params.name);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    const hash = await computeSha256(params.name);
    const sent = await sendBackupEmail({
      filePath: full,
      fileName: params.name,
      sizeBytes: stat.size,
      sha256: hash,
      createdAt: stat.mtime.toISOString(),
      encrypted: params.name.endsWith(".enc"),
    });
    return NextResponse.json({ ok: true, messageId: sent.messageId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
