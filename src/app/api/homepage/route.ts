import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";
import {
  DEFAULT_HOMEPAGE,
  getHomepage,
  setHomepage,
  type HomepageContent,
} from "@/lib/homepage";

/**
 * Public read of the editable hero content. PATCH (admin) updates it.
 * Both endpoints are IP-rate-limited.
 */
export const dynamic = "force-dynamic";

const homepageSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  heroBadge: z.string().trim().min(1).max(120),
  heroTitle: z.string().trim().min(1).max(300),
  heroTitleGradient: z.string().max(200).default(""),
  heroSubtitle: z.string().trim().min(1).max(1000),
  heroFooter: z.string().trim().min(1).max(200),
});

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const content = await getHomepage();
  return NextResponse.json(
    { content },
    { headers: { "Cache-Control": "no-cache" } },
  );
}

export async function PATCH(req: Request) {
  const limited = enforceRateLimit(req, WRITE_LIMIT);
  if (limited) return limited;
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const parsed = homepageSchema.parse(body);
    const next: HomepageContent = { ...DEFAULT_HOMEPAGE, ...parsed };
    await setHomepage(next);
    return NextResponse.json({ content: next });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
