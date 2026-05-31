import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_RUNTIME_CONFIG,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  getRuntimeConfig,
  updateRuntimeConfig,
} from "@/lib/runtime-config";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * GET / PATCH /api/runtime-config
 *
 * GET is intentionally PUBLIC (rate-limited) — the public homepage
 * needs to know its own polling cadence too, not just admin pages.
 * The values here are not sensitive: they're just numbers in the
 * 2_000 — 600_000 range.
 *
 * PATCH is admin-only.
 */
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    refreshMs: z.number().int().min(MIN_REFRESH_MS).max(MAX_REFRESH_MS).optional(),
    activityRefreshMs: z
      .number()
      .int()
      .min(MIN_REFRESH_MS)
      .max(MAX_REFRESH_MS)
      .optional(),
  })
  .refine((v) => v.refreshMs !== undefined || v.activityRefreshMs !== undefined, {
    message: "At least one of refreshMs or activityRefreshMs is required",
  });

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;
  const cfg = await getRuntimeConfig();
  return NextResponse.json(
    {
      config: cfg,
      defaults: DEFAULT_RUNTIME_CONFIG,
      bounds: { min: MIN_REFRESH_MS, max: MAX_REFRESH_MS },
    },
    {
      headers: {
        // Short cache so a tweak from Admin → Settings is picked up
        // by visitors within ~10s without hammering the DB.
        "Cache-Control": "public, max-age=10",
      },
    },
  );
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
    const cfg = await updateRuntimeConfig(body);
    return NextResponse.json({ config: cfg });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 400 });
  }
}
