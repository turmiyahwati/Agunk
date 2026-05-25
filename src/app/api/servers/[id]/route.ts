import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { serializeServer } from "@/lib/serialize";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  country: z.string().min(2).max(4).optional(),
  countryName: z.string().min(1).optional(),
  flag: z.string().url().nullable().optional(),
  provider: z.string().min(1).optional(),
  apiUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  refreshMs: z.number().int().min(1000).max(600000).optional(),
  maxSlot: z.number().int().min(1).max(100000).optional(),
  status: z.enum(["ONLINE", "OFFLINE", "FULL", "WARNING", "UNKNOWN"]).optional(),
  activeUsers: z.number().int().min(0).optional(),
  pingMs: z.number().int().min(0).optional(),
  speedMbps: z.number().int().min(0).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const server = await prisma.server.findUnique({ where: { id: params.id } });
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ server: serializeServer(server) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const data = updateSchema.parse(await req.json());
    const server = await prisma.server.update({ where: { id: params.id }, data });
    return NextResponse.json({ server: serializeServer(server) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.errors?.[0]?.message || e?.message || "Invalid request" },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await prisma.server.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
