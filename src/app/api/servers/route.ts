import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { serializeServers } from "@/lib/serialize";

const createSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  country: z.string().min(2).max(4),
  countryName: z.string().min(1),
  flag: z.string().url().nullable().optional(),
  provider: z.string().min(1),
  apiUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  refreshMs: z.number().int().min(1000).max(600000).optional(),
  maxSlot: z.number().int().min(1).max(100000),
  // optional manual override
  activeUsers: z.number().int().min(0).optional(),
  pingMs: z.number().int().min(0).optional(),
  speedMbps: z.number().int().min(0).optional(),
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
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.errors?.[0]?.message || e?.message || "Invalid request" },
      { status: 400 },
    );
  }
}
