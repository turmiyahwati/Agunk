import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/**
 * Admin-only authentication.
 * In-memory anti-bruteforce: 5 failed attempts per email within 60s
 * triggers a soft lockout (silent reject — no info leak).
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED = 5;
const WINDOW_MS = 60_000;

function checkLoginThrottle(email: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now > entry.resetAt) return true;
  return entry.count < MAX_FAILED;
}

function recordFailedLogin(email: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
  if (loginAttempts.size > 1000) {
    for (const [key, val] of loginAttempts.entries()) {
      if (now > val.resetAt) loginAttempts.delete(key);
    }
  }
}

function clearLoginAttempts(email: string): void {
  loginAttempts.delete(email);
}

/**
 * Defensive NEXTAUTH_SECRET resolution.
 *
 * In production the secret MUST be set via env. In development we accept
 * a deterministic fallback so login still works when `.env` failed to
 * load (Windows BOM, stale dev server, etc.) — sessions will keep working
 * across restarts because the secret is stable.
 */
function resolveSecret(): string {
  const fromEnv = process.env.NEXTAUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    // Don't mask in prod. NextAuth will refuse to issue sessions if missing.
    // eslint-disable-next-line no-console
    console.error("[auth] NEXTAUTH_SECRET not set in production!");
    return fromEnv || "";
  }

  // Stable dev fallback. Never use this in production.
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] NEXTAUTH_SECRET not set — using deterministic dev fallback. " +
      "Set NEXTAUTH_SECRET in your .env (openssl rand -base64 32) for production.",
  );
  return "dev-only-fallback-secret-please-replace-in-production-32chars";
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;

        const email = creds.email.toLowerCase().trim();

        if (!checkLoginThrottle(email)) {
          return null;
        }

        try {
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user || !user.active || !user.password) {
            recordFailedLogin(email);
            return null;
          }

          const ok = await bcrypt.compare(creds.password, user.password);
          if (!ok) {
            recordFailedLogin(email);
            return null;
          }

          clearLoginAttempts(email);
          return { id: user.id, email: user.email, name: user.name } as any;
        } catch (err) {
          // Never let a DB error explode the auth flow — the form will
          // simply show "wrong credentials" and the operator sees the real
          // cause in the server logs.
          // eslint-disable-next-line no-console
          console.error("[auth] authorize() error:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  secret: resolveSecret(),
};
