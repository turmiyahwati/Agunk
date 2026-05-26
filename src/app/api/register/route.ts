import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, REGISTER_LIMIT } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/api-error";

const schema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export async function POST(req: Request) {
  // Anti-bruteforce: 3 registrations per 60s per IP
  const rl = rateLimit(req, REGISTER_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists)
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const hash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, password: hash, role: "MEMBER" },
      select: { id: true, name: true, email: true, role: true },
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 400 });
  }
}
