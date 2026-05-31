import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { enforceRateLimit, LOGIN_LIMIT } from "@/lib/rate-limit";

/**
 * NextAuth's catch-all handler covers many sub-routes (signin, signout,
 * csrf, providers, callback/credentials, …). Of those, only the
 * `callback/credentials` POST is a credential-bearing brute-force
 * surface, so that is the single path where we want IP-based rate
 * limiting on top of the per-email throttle that lives inside
 * `lib/auth.ts`. The other POSTs (signout, csrf rotation) are not
 * password attempts and shouldn't be throttled — doing so would punish
 * legitimate dashboard users for clicking "logout" repeatedly.
 *
 * GET requests (the OAuth flow GETs, providers list, csrf token) are
 * intentionally NOT rate-limited here — they are read-only, idempotent,
 * and already protected by NextAuth's own CSRF/PKCE handling.
 */
const handler = NextAuth(authOptions);

export async function POST(
  req: NextRequest,
  ctx: { params: { nextauth: string[] } },
) {
  const seg = ctx.params.nextauth ?? [];
  const isCredCallback = seg[0] === "callback" && seg[1] === "credentials";
  if (isCredCallback) {
    const limited = enforceRateLimit(req, LOGIN_LIMIT);
    if (limited) return limited;
  }
  return handler(req as unknown as Request, ctx);
}

export const GET = handler as unknown as typeof handler;
