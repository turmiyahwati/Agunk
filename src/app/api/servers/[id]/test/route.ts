import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { testConnection, syncServer } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const s = await prisma.server.findUnique({ where: { id: params.id } });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!s.apiUrl) return NextResponse.json({ error: "apiUrl not configured" }, { status: 400 });

  const result = await testConnection(s.apiUrl, s.apiKey);
  if (result.ok) {
    await syncServer(s.id).catch(() => {});
  }
  return NextResponse.json(result);
}
