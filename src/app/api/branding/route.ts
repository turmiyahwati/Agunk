import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";
import {
  getLogoUrl,
  setLogoUrl,
  clearLogoUrl,
  detectImageMime,
  MAX_LOGO_BYTES,
  ALLOWED_LOGO_MIME,
} from "@/lib/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPLOAD_DIR_REL = "public/uploads";
const PUBLIC_URL_PREFIX = "/uploads";

/**
 * GET — public read of the current logo URL. Rate-limited per IP.
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const url = await getLogoUrl();
  return NextResponse.json(
    { logo: url },
    {
      headers: {
        "Cache-Control": "no-cache",
      },
    },
  );
}

/**
 * POST — admin-only logo upload (multipart/form-data, field "file").
 *
 * Security:
 *   - admin session required + per-IP rate limit
 *   - validates the declared MIME type against an allowlist
 *   - re-validates via magic-byte sniff (defense-in-depth)
 *   - enforces a 1 MB size cap
 *   - filename is server-generated (logo-{epoch}.{ext}) — never trust input
 *   - file extension is derived from the verified MIME, not the filename
 *   - old logo file is unlinked after a successful replacement
 *   - path containment check: writes are constrained to public/uploads
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(MAX_LOGO_BYTES / 1024)} KB)` },
        { status: 413 },
      );
    }
    if (!(ALLOWED_LOGO_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, or WEBP images are allowed" },
        { status: 415 },
      );
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    const sniffed = detectImageMime(buf);
    if (!sniffed) {
      return NextResponse.json({ error: "File content is not a valid image" }, { status: 400 });
    }
    if (sniffed !== file.type) {
      return NextResponse.json({ error: "File type mismatch" }, { status: 400 });
    }

    const ext = sniffed === "image/png" ? "png" : sniffed === "image/jpeg" ? "jpg" : "webp";
    const filename = `logo-${Date.now()}.${ext}`;

    const uploadDir = path.join(process.cwd(), UPLOAD_DIR_REL);
    await fs.mkdir(uploadDir, { recursive: true });

    const fullPath = path.join(uploadDir, filename);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(uploadDir))) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await fs.writeFile(fullPath, buf, { mode: 0o644 });

    // Best-effort cleanup of the previous logo file.
    const previous = await getLogoUrl();
    if (previous?.startsWith(PUBLIC_URL_PREFIX + "/")) {
      const previousFile = path.join(
        process.cwd(),
        "public",
        previous.replace(/^\/+/, ""),
      );
      const safePrev = path.resolve(previousFile);
      if (safePrev.startsWith(path.resolve(uploadDir))) {
        await fs.unlink(safePrev).catch(() => {});
      }
    }

    const publicUrl = `${PUBLIC_URL_PREFIX}/${filename}`;
    await setLogoUrl(publicUrl);

    return NextResponse.json({ logo: publicUrl });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}

/**
 * DELETE — admin-only reset to default logo.
 */
export async function DELETE(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const previous = await getLogoUrl();
    await clearLogoUrl();

    if (previous?.startsWith(PUBLIC_URL_PREFIX + "/")) {
      const uploadDir = path.join(process.cwd(), UPLOAD_DIR_REL);
      const previousFile = path.join(
        process.cwd(),
        "public",
        previous.replace(/^\/+/, ""),
      );
      const safePrev = path.resolve(previousFile);
      if (safePrev.startsWith(path.resolve(uploadDir))) {
        await fs.unlink(safePrev).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
