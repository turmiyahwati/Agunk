import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { serializeServer } from "@/lib/serialize";
import { safeErrorMessage } from "@/lib/api-error";

/**
 * Same forgiving apiUrl validator as the create route. Auto-prefixes
 * `http://` for bare hosts and strips trailing slashes before strict
 * Zod URL parsing. Eliminates the most common admin paste mistake.
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

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  country: z.string().min(2).max(4).optional(),
  countryName: z.string().min(1).optional(),
  flag: z.string().url().nullable().optional(),
  provider: z.string().min(1).optional(),
  apiUrl,
  apiKey: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  refreshMs: z.number().int().min(1000).max(600000).optional(),
  maxSlot: z.number().int().min(1).max(100000).optional(),
  status: z.enum(["ONLINE", "OFFLINE", "FULL", "WARNING", "UNKNOWN"]).optional(),
  activeUsers: z.number().int().min(0).optional(),
  pingMs: z.number().int().min(0).optional(),
  speedMbps: z.number().min(0).optional(),
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
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    await prisma.server.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
