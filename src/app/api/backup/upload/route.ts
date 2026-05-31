import { NextResponse } from "next/server";
import { stashUpload, validateUpload, pruneStaleUploads, BACKUP_LIMITS } from "@/lib/backup";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/backup/upload
 *
 * Multipart form upload of a backup file for restore. Persists the
 * blob to a quarantine dir under a random session id, then runs
 * `validateUpload` to parse the manifest and return a preview to the
 * admin UI. The file is NOT applied yet — the admin must POST to
 * /api/backup/restore with the same session id and explicit confirm.
 *
 * Form fields:
 *   file        binary, max 100 MB
 *   passphrase  optional — used only when filename ends with .enc
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Next 14 cap: per-route body-size override. 100 MB ≈ 104857600 bytes.
export const maxDuration = 60;

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Best-effort cleanup of stale sessions before each upload.
  await pruneStaleUploads();

  const form = await req.formData();
  const file = form.get("file");
  const passphrase = (form.get("passphrase") as string | null) || null;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const blob = file as File;
  if (blob.size > BACKUP_LIMITS.MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${BACKUP_LIMITS.MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 },
    );
  }

  if (!/^[A-Za-z0-9._-]+\.tar\.gz(\.enc)?$/.test(blob.name)) {
    return NextResponse.json(
      { error: "Filename must look like 'sontoloyo-backup-...tar.gz' or '.tar.gz.enc'." },
      { status: 400 },
    );
  }

  // Stream the upload onto disk inside a quarantine session.
  const arrayBuf = await blob.arrayBuffer();
  const stash = await stashUpload(blob.name, Buffer.from(arrayBuf));

  // Validate + extract manifest. Surface any error directly to the UI
  // — the operator needs to know whether passphrase was wrong, archive
  // was malformed, contained traversal, etc.
  try {
    const v = await validateUpload({
      sessionId: stash.sessionId,
      passphrase,
    });
    return NextResponse.json({ sessionId: stash.sessionId, ...v });
  } catch (err) {
    return NextResponse.json(
      { ok: false, sessionId: stash.sessionId, error: (err as Error).message },
      { status: 400 },
    );
  }
}
