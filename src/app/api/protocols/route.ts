import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";
import { enforceRateLimit, PUBLIC_API_LIMIT, WRITE_LIMIT } from "@/lib/rate-limit";
import {
  PROTOCOL_SLUGS,
  getProtocols,
  setProtocols,
  type ProtocolItem,
} from "@/lib/protocols";

/**
 * Public read of the editable Protocol Information cards.
 * PATCH (admin) replaces the full ordered list. Both endpoints are
 * IP-rate-limited.
 */
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  slug: z.enum(PROTOCOL_SLUGS),
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200).default(""),
  bullet1: z.string().trim().max(150).default(""),
  bullet2: z.string().trim().max(150).default(""),
  active: z.boolean(),

  subtitle: z.string().trim().max(200).default(""),
  body: z.string().trim().max(800).default(""),
  feature1Label: z.string().trim().max(50).default(""),
  feature1Value: z.string().trim().max(50).default(""),
  feature2Label: z.string().trim().max(50).default(""),
  feature2Value: z.string().trim().max(50).default(""),
  feature3Label: z.string().trim().max(50).default(""),
  feature3Value: z.string().trim().max(50).default(""),
});

const payloadSchema = z
  .object({
    protocols: z.array(itemSchema).length(PROTOCOL_SLUGS.length),
  })
  .refine(
    (p) => new Set(p.protocols.map((x) => x.slug)).size === PROTOCOL_SLUGS.length,
    { message: "Each protocol slug must appear exactly once." },
  );

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
  if (limited) return limited;

  const protocols = await getProtocols();
  return NextResponse.json(
    { protocols },
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
    const parsed = payloadSchema.parse(body);
    const ordered: ProtocolItem[] = PROTOCOL_SLUGS.map(
      (slug) => parsed.protocols.find((p) => p.slug === slug)!,
    );
    await setProtocols(ordered);
    return NextResponse.json({ protocols: ordered });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
