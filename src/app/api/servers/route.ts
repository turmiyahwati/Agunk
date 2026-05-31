import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { serializeServers } from "@/lib/serialize";
import { safeErrorMessage } from "@/lib/api-error";

/**
 * Forgiving apiUrl validator: users routinely paste bare hosts like
 *   "1.2.3.4:8787"  or  "agent.example.com/"
 * We auto-prefix `http://` when missing and strip trailing slashes
 * before handing the value to Zod's strict URL parser.
 */
const apiUrl = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null) return v;
    const t = v.trim();
    if (!t) return null;
    const withScheme = /^https?:\/\//i.test(t) ? t : `http://${t}`;
    return withScheme.replace(/\/+$/, "");
  })
  .pipe(z.string().url().nullable().optional());

const createSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  country: z.string().min(2).max(4),
  countryName: z.string().min(1),
  flag: z.string().url().nullable().optional(),
  provider: z.string().min(1),
  apiUrl,
  apiKey: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  refreshMs: z.number().int().min(1000).max(600000).optional(),
  maxSlot: z.number().int().min(1).max(100000),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const servers = await prisma.server.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ servers: serializeServers(servers) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const created = await prisma.server.create({ data });
    return NextResponse.json({ server: { ...created, rxBytes: 0, txBytes: 0 } }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
