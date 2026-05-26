import { PrismaClient } from "@prisma/client";

/**
 * Defensive environment loading.
 *
 * Next.js auto-loads `.env` from the project root, so 99% of the time
 * `process.env.DATABASE_URL` is already populated by the time this file
 * runs. However on Windows we have repeatedly seen the file fail to load
 * (UTF-16 BOM from PowerShell, stale dev server started before .env was
 * created, missing file, etc.). When that happens the previous behavior
 * was a hard crash with the cryptic "Environment variable not found:
 * DATABASE_URL" error which then cascades into 500s on every API route.
 *
 * To make local development robust, fall back to a relative SQLite file
 * inside `prisma/dev.db` when the variable is missing in development.
 * Production deployments must continue to set DATABASE_URL explicitly —
 * we deliberately do NOT mask the error in production.
 */
if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    // Surface the original Prisma error in prod — do not silently mask.
    // eslint-disable-next-line no-console
    console.error(
      "[prisma] DATABASE_URL is not set. Configure it in your hosting panel or .env file.",
    );
  } else {
    process.env.DATABASE_URL = "file:./dev.db";
    // eslint-disable-next-line no-console
    console.warn(
      "\n[prisma] DATABASE_URL not set — falling back to file:./dev.db (dev only).\n" +
        "         Make sure your .env file exists at the project root, is UTF-8\n" +
        "         encoded (no BOM), and that you restarted `npm run dev` after\n" +
        "         creating it.\n",
    );
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
