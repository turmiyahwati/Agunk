#!/usr/bin/env node
/**
 * Lightweight database backup helper for PT Sontoloyo Monitor.
 *
 *  - SQLite (default): copies prisma/dev.db to backups/db-<ISO>.db
 *  - Non-file DATABASE_URL (postgres / mysql): prints the recommended
 *    `pg_dump` / `mysqldump` cron snippet and exits 0 — we do NOT
 *    spawn external dump tools here so this script stays portable.
 *  - Auto-cleans backups older than BACKUP_RETENTION_DAYS (default 14).
 *
 * Usage:
 *    node scripts/backup-db.mjs
 *    npm run db:backup
 *
 * Cron (Linux / VPS, run daily at 02:30 server time):
 *    30 2 * * * cd /opt/sontoloyo-monitor && node scripts/backup-db.mjs >> /var/log/sontoloyo-backup.log 2>&1
 */
import "node:fs";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const DB_URL = (process.env.DATABASE_URL || "file:./dev.db").trim();
const BACKUP_DIR = resolve(process.cwd(), "backups");
const RETENTION_DAYS = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14));

function info(msg) { console.log("\u001b[36m[backup]\u001b[0m " + msg); }
function warn(msg) { console.log("\u001b[33m[backup]\u001b[0m " + msg); }
function err(msg)  { console.error("\u001b[31m[backup]\u001b[0m " + msg); }

function pruneOld() {
  if (!existsSync(BACKUP_DIR)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  for (const f of readdirSync(BACKUP_DIR)) {
    if (!/\.(db|sql|sql\.gz)$/.test(f)) continue;
    const p = join(BACKUP_DIR, f);
    try {
      if (statSync(p).mtimeMs < cutoff) {
        unlinkSync(p);
        info("cleaned old backup: " + f);
      }
    } catch {
      /* ignore individual cleanup errors */
    }
  }
}

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

if (DB_URL.startsWith("file:")) {
  // ─── SQLite ───────────────────────────────────────────────
  const rel = DB_URL.slice(5).replace(/^\.?\//, "");
  // Prisma resolves the SQLite path relative to the schema file.
  const candidates = [
    resolve(process.cwd(), "prisma", rel),
    resolve(process.cwd(), rel),
  ];
  const dbFile = candidates.find((c) => existsSync(c));
  if (!dbFile) {
    err("SQLite file not found. Tried: " + candidates.join(", "));
    process.exit(1);
  }
  const dest = join(BACKUP_DIR, `db-${stamp}.db`);
  copyFileSync(dbFile, dest);
  info("saved: " + dest);
  pruneOld();
  info(`done. Retention: ${RETENTION_DAYS} day(s).`);
  process.exit(0);
}

if (DB_URL.startsWith("postgres") || DB_URL.startsWith("mysql")) {
  warn("DATABASE_URL is not SQLite. This helper only handles file-based DBs.");
  warn("Recommended cron snippet for your setup:");
  if (DB_URL.startsWith("postgres")) {
    console.log("  pg_dump \"$DATABASE_URL\" | gzip > backups/db-$(date +%Y%m%d).sql.gz");
  } else {
    console.log("  mysqldump \"$DATABASE_URL\" | gzip > backups/db-$(date +%Y%m%d).sql.gz");
  }
  pruneOld();
  process.exit(0);
}

err("Unsupported DATABASE_URL scheme. Skipping backup.");
process.exit(1);
