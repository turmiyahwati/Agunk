import { NextResponse } from "next/server";
import { deleteBackup } from "@/lib/backup";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * DELETE /api/backup/[name]
 *
 * Remove a backup file from disk. Sidecar `.sha256` is deleted too.
 * Cron-managed retention also handles aging files automatically;
 * this endpoint is for the admin "trash" button on individual rows.
 */
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: { name: string } },
) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    await deleteBackup(params.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
