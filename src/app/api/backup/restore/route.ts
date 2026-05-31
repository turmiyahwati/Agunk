import { NextResponse } from "next/server";
import { applyRestore } from "@/lib/backup";
import { requireAdmin } from "@/lib/guards";
import { enforceRateLimit, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * POST /api/backup/restore
 *
 * Apply a previously-validated upload session. Body must include the
 * `confirm` field set to the literal string "RESTORE" — defense in
 * depth against drive-by clicks (CSRF protection itself is provided
 * by NextAuth + the admin-only guard).
 *
 * Body (JSON):
 *   { "sessionId": "<from /api/backup/upload>",
 *     "passphrase": "<optional, only for .enc archives>",
 *     "confirm": "RESTORE" }
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { sessionId?: string; passphrase?: string; confirm?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: "Restore not confirmed. Pass confirm: \"RESTORE\"." },
      { status: 400 },
    );
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const result = await applyRestore({
      sessionId: body.sessionId,
      passphrase: body.passphrase ?? null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "Restore script failed", output: result.output },
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
