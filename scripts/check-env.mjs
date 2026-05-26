#!/usr/bin/env node
/**
 * Tiny helper that runs before `npm run dev` and `npm run build`.
 *
 *  - if .env is missing, copy .env.example to .env so Next.js & Prisma
 *    can find DATABASE_URL on first launch (this is the #1 cause of the
 *    "Environment variable not found: DATABASE_URL" error on Windows).
 *  - if .env exists but DATABASE_URL is not declared, print a friendly
 *    warning and continue (lib/prisma.ts has a SQLite fallback for dev).
 *
 * It never overwrites an existing .env and never touches it after the
 * first creation. No secrets leak — we only copy the public template.
 */
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

function info(msg)  { console.log("\u001b[36m[setup]\u001b[0m " + msg); }
function warn(msg)  { console.log("\u001b[33m[setup]\u001b[0m " + msg); }

if (!existsSync(envPath)) {
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    info(".env was missing — copied from .env.example.");
    warn("Edit .env to set NEXTAUTH_SECRET and (optionally) admin credentials.");
  } else {
    warn(".env and .env.example are both missing. Skipping env bootstrap.");
  }
} else {
  // Sanity check: make sure DATABASE_URL is declared. We don't read its
  // value (could be a real prod connection string) — just check presence.
  try {
    const text = readFileSync(envPath, "utf8");
    if (!/^\s*DATABASE_URL\s*=/m.test(text)) {
      warn(".env exists but DATABASE_URL is not declared.");
      warn("lib/prisma.ts will fall back to file:./dev.db for local dev.");
    }
  } catch {
    // ignore — fallback in lib/prisma.ts will handle it
  }
}
