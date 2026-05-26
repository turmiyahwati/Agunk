import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import {
  PROTOCOL_SLUGS,
  getProtocols,
  setProtocols,
  type ProtocolItem,
} from "@/lib/protocols";

/**
 * Public read of the editable Protocol Information cards.
 * PATCH (admin) replaces the full ordered list. GET is open — the
 * homepage is public.
 */
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  slug: z.enum(PROTOCOL_SLUGS),
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200).default(""),
  bullet1: z.string().trim().min(1).max(150),
  bullet2: z.string().trim().min(1).max(150),
  active: z.boolean(),
});

const payloadSchema = z
  .object({
    protocols: z.array(itemSchema).length(PROTOCOL_SLUGS.length),
  })
  .refine(
    (p) => new Set(p.protocols.map((x) => x.slug)).size === PROTOCOL_SLUGS.length,
    { message: "Each protocol slug must appear exactly once." },
  );

export async function GET() {
  const protocols = await getProtocols();
  return NextResponse.json(
    { protocols },
    { headers: { "Cache-Control": "no-cache" } },
  );
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const parsed = payloadSchema.parse(body);
    // Normalize to canonical slug order so the public grid layout is
    // deterministic regardless of how the form serialized the array.
    const ordered: ProtocolItem[] = PROTOCOL_SLUGS.map(
      (slug) => parsed.protocols.find((p) => p.slug === slug)!,
    );
    await setProtocols(ordered);
    return NextResponse.json({ protocols: ordered });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
