import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import {
  DEFAULT_HOMEPAGE,
  getHomepage,
  setHomepage,
  type HomepageContent,
} from "@/lib/homepage";

/**
 * Public read of the editable hero content. PATCH (admin) updates it.
 * GET is intentionally open — the homepage is public.
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

export async function GET() {
  const content = await getHomepage();
  return NextResponse.json(
    { content },
    { headers: { "Cache-Control": "no-cache" } },
  );
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const parsed = homepageSchema.parse(body);
    // Always persist a complete content object so legacy fields can never
    // half-update; merge on top of defaults to satisfy the type contract.
    const next: HomepageContent = { ...DEFAULT_HOMEPAGE, ...parsed };
    await setHomepage(next);
    return NextResponse.json({ content: next });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
