import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/api-error";

/**
 * Public read of recent VPN account creation events.
 *
 * Only safe metadata is exposed: protocol kind, server name, action,
 * and timestamp. Usernames, passwords, UUIDs, IPs, tokens, and any
 * other credential are NEVER stored in this table.
 */
export const dynamic = "force-dynamic";

const PROTOCOLS = ["SSH", "VMESS", "VLESS", "TROJAN"] as const;
const ACTIONS = ["CREATE"] as const;

const createSchema = z.object({
  protocol: z.enum(PROTOCOLS),
  serverName: z.string().min(1).max(80),
  action: z.enum(ACTIONS).default("CREATE"),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 12)));

  try {
    const rows = await prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        protocol: true,
        serverName: true,
        action: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      activities: rows.map((r) => ({
        id: r.id,
        protocol: r.protocol,
        serverName: r.serverName,
        action: r.action,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch {
    // If the table does not yet exist (forgot to migrate), return empty.
    return NextResponse.json({ activities: [] });
  }
}

/**
 * Admin-only ingest. Designed to be called from the operator's order
 * system after a VPN account is created. Strict allowlist on protocol
 * + action; any other field in the body is ignored.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const data = createSchema.parse(await req.json());
    const created = await prisma.activity.create({
      data,
      select: { id: true, protocol: true, serverName: true, action: true, createdAt: true },
    });
    return NextResponse.json(
      {
        activity: { ...created, createdAt: created.createdAt.toISOString() },
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
