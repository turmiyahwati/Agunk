import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/**
 * In-memory login attempt tracker for anti-bruteforce.
 * 5 failed attempts per email within 60s → temporary lockout.
 * This runs server-side only.
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED = 5;
const WINDOW_MS = 60_000;

function checkLoginThrottle(email: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now > entry.resetAt) {
    return true; // allowed
  }
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
  // Periodic cleanup
  if (loginAttempts.size > 1000) {
    for (const [key, val] of loginAttempts.entries()) {
      if (now > val.resetAt) loginAttempts.delete(key);
    }
  }
}

function clearLoginAttempts(email: string): void {
  loginAttempts.delete(email);
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

        // Anti-bruteforce: check if this email is temporarily locked
        if (!checkLoginThrottle(email)) {
          return null; // silently reject — no info leak about lockout reason
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) {
          recordFailedLogin(email);
          return null;
        }

        const ok = await bcrypt.compare(creds.password, user.password);
        if (!ok) {
          recordFailedLogin(email);
          return null;
        }

        // Success — clear failed attempts
        clearLoginAttempts(email);
        return { id: user.id, email: user.email, name: user.name, role: user.role } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
