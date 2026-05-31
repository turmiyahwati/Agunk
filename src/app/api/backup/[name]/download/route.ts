import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { resolveBackupPath } from "@/lib/backup";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * GET /api/backup/[name]/download
 *
 * Stream a backup file to the admin's browser as an attachment.
 * Uses the WRITE_LIMIT preset because download is a sensitive
 * operation (the file is encrypted but exfiltration still has cost).
 */
export const dynamic = "force-dynamic";

export async function GET(
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

  // Read into memory — backups are small (<10 MB typical, 100 MB ceiling).
  // Streaming via web-stream API plays poorly with Next's edge runtime
  // on certain providers; in-memory keeps behavior consistent.
  const buf = await fs.readFile(full);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${params.name}"`,
      "Cache-Control": "no-store",
    },
  });
}
