import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Cron file management for the dashboard's auto-managed crontab.
 *
 * The installer (`scripts/install-dashboard.sh`, step 9) writes
 * `/etc/cron.d/sontoloyo` with two entries:
 *
 *   1. Every-minute curl POST to `/api/monitor/sync` (sync safety net).
 *   2. Encrypted backup script at one of 5 fixed cadences keyed by
 *      `intervalHours` (1 / 3 / 6 / 12 / 24).
 *
 * Historically the only way to retune cadence (1) was hand-editing
 * the cron file, and (2) required a re-run of the installer. This
 * module renders the same file format and gives the admin UI a way
 * to apply changes at runtime without SSH.
 *
 * Keep `buildCronFile()` PURE — no I/O — so unit tests can pin the
 * exact string format. `applyCron()` is the side-effecting wrapper
 * that writes + reloads.
 */

export type CronFileInput = {
  /** Public domain (e.g. "monitoring.example.com") used in the curl URL. */
  domain: string;
  /** Bearer token sent as `X-Sync-Token` header. */
  syncToken: string;
  /** Backup-script directory (the install root). */
  installDir: string;
  /** Backup cadence in hours. Must be one of [1, 3, 6, 12, 24]. */
  intervalHours: number;
};

export type CronApplyResult = {
  ok: boolean;
  /** Absolute path of the cron file we attempted to manage. */
  path: string;
  /** Rendered cron file content (always returned for review, even on failure). */
  content: string;
  /** True when bytes were successfully written to disk. */
  written: boolean;
  /** True when `systemctl reload cron` (or restart fallback) succeeded. */
  reloaded: boolean;
  /** Human-readable reason on failure. Null on full success. */
  error: string | null;
  /** Friendly cadence string for the UI ("setiap 3 jam", etc.). */
  cadence: string;
};

/** Default cron file path — matches install-dashboard.sh. Override
 *  via env `SONTOLOYO_CRON_FILE` for tests / non-standard installs. */
export const DEFAULT_CRON_PATH = "/etc/cron.d/sontoloyo";

/**
 * Map an interval (hours) to the literal cron expression and a Bahasa
 * cadence label. The mapping is explicit (not a generic `0 *<slash>N * * *`
 * formula) because cron interprets `*<slash>7` as "every hour whose number
 * is divisible by 7" — i.e. 00:00 and 07:00 only. We keep the same
 * 5 supported buckets as install-dashboard.sh so the two stay in sync.
 */
export function intervalToCron(hours: number): { expr: string; cadence: string; intervalHours: number } {
  switch (hours) {
    case 1:
      return { expr: "0 *  * * *", cadence: "setiap jam", intervalHours: 1 };
    case 3:
      return { expr: "0 */3 * * *", cadence: "setiap 3 jam", intervalHours: 3 };
    case 6:
      return { expr: "0 */6 * * *", cadence: "setiap 6 jam", intervalHours: 6 };
    case 12:
      return { expr: "0 */12 * * *", cadence: "setiap 12 jam", intervalHours: 12 };
    case 24:
      return { expr: "30 2 * * *", cadence: "harian 02:30 WIB", intervalHours: 24 };
    default:
      // Mirror the installer fallback — unknown values become 3h.
      return { expr: "0 */3 * * *", cadence: "setiap 3 jam (default)", intervalHours: 3 };
  }
}

/**
 * Render the full `/etc/cron.d/sontoloyo` file contents as a string.
 *
 * Pure function. No filesystem access. Trailing newline included so
 * `cat` / `crontab -l` shows the file cleanly.
 */
export function buildCronFile(input: CronFileInput): { content: string; cadence: string } {
  const { domain, syncToken, installDir, intervalHours } = input;
  const { expr, cadence } = intervalToCron(intervalHours);

  // Validate inputs defensively. Bad chars in `domain` or `installDir`
  // could let an attacker break out of the cron line — every value
  // we write here goes onto a literal shell line executed as root.
  assertSafeForCron("domain", domain);
  assertSafeForCron("installDir", installDir);
  assertSafeToken("syncToken", syncToken);

  const lines = [
    "# PT Sontoloyo Monitor — auto-managed by /api/backup/cron/apply",
    "# Edit this file via Admin → Settings or Admin → Backup & Recovery.",
    "# Manual edits will be overwritten on the next Apply.",
    "",
    "# Auto-sync every minute (safety net; in-process autosync also runs).",
    `* * * * * root curl -fsS --max-time 30 -H "X-Sync-Token: ${syncToken}" -X POST https://${domain}/api/monitor/sync >> /var/log/sontoloyo-sync.log 2>&1`,
    "",
    `# Encrypted full-state backup — schedule: ${cadence} (interval ${intervalHours}h).`,
    `${expr} root cd ${installDir} && /bin/bash scripts/backup-all.sh >> /var/log/sontoloyo-backup.log 2>&1`,
    "",
  ];

  return { content: lines.join("\n"), cadence };
}

/**
 * Whitelist-check a value that will be embedded literally in a cron
 * line. Allow only characters we expect for a domain or filesystem
 * path. Reject newlines (cron-line injection), backticks, $, &, |, ;.
 */
function assertSafeForCron(field: string, value: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (value.length > 256) throw new Error(`${field} too long`);
  if (!/^[A-Za-z0-9._\-/:]+$/.test(value)) {
    throw new Error(`${field} contains characters not allowed in a cron line`);
  }
}

/**
 * Tokens may contain a wider set of characters (base64 / hex / bcrypt),
 * but must still be free of spaces, quotes, and shell metacharacters.
 */
function assertSafeToken(field: string, value: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (value.length > 256) throw new Error(`${field} too long`);
  if (/["'`$\\\s|&;<>(){}*?!#]/.test(value)) {
    throw new Error(`${field} contains characters not allowed in a cron line`);
  }
}

/**
 * Resolve cron file path. Honours `SONTOLOYO_CRON_FILE` env override
 * for testing on non-system paths (e.g. /tmp/cron.d/sontoloyo).
 */
export function getCronPath(): string {
  return process.env.SONTOLOYO_CRON_FILE || DEFAULT_CRON_PATH;
}

/**
 * Write the rendered cron file and reload cron. Soft-fails — every
 * failure path returns a structured `CronApplyResult` instead of
 * throwing, so the API caller can surface a precise message
 * ("permission denied", "cron not installed", etc.) without crashing.
 *
 * In dev (non-Linux, non-root) the most common failure is `EACCES` on
 * `/etc/cron.d/sontoloyo` — that returns ok=false, written=false and
 * a clear error message. Production deploys via PM2 typically run as
 * root and write succeeds.
 */
export async function applyCron(input: CronFileInput): Promise<CronApplyResult> {
  const cronPath = getCronPath();
  let content = "";
  let cadence = "";
  try {
    const built = buildCronFile(input);
    content = built.content;
    cadence = built.cadence;
  } catch (err) {
    return {
      ok: false,
      path: cronPath,
      content: "",
      written: false,
      reloaded: false,
      error: (err as Error).message || "Failed to render cron file",
      cadence: "",
    };
  }

  // Linux only — bail out early on macOS / Windows dev.
  if (process.platform !== "linux") {
    return {
      ok: false,
      path: cronPath,
      content,
      written: false,
      reloaded: false,
      error: `cron apply is Linux-only (current platform: ${process.platform})`,
      cadence,
    };
  }

  // Make sure the parent directory exists. /etc/cron.d should always
  // be there on Debian/Ubuntu but a custom SONTOLOYO_CRON_FILE may
  // point at /tmp or similar.
  try {
    await fs.mkdir(path.dirname(cronPath), { recursive: true });
  } catch {
    /* best-effort — write below will surface the real error */
  }

  // Write atomically: write to a sibling tempfile then rename. Avoids
  // a window where cron sees a partially-written file.
  const tmp = `${cronPath}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o644 });
    await fs.rename(tmp, cronPath);
    await fs.chmod(cronPath, 0o644).catch(() => {});
  } catch (err) {
    // Clean up the tmp file if the rename failed mid-flight.
    await fs.unlink(tmp).catch(() => {});
    return {
      ok: false,
      path: cronPath,
      content,
      written: false,
      reloaded: false,
      error: `write failed: ${(err as NodeJS.ErrnoException).code || (err as Error).message}`,
      cadence,
    };
  }

  // Reload cron. Try `reload` first (less disruptive), fallback to
  // `restart`, then to `service` for older init systems.
  let reloaded = false;
  let reloadError: string | null = null;
  for (const cmd of [
    ["systemctl", "reload", "cron"],
    ["systemctl", "restart", "cron"],
    ["service", "cron", "reload"],
  ]) {
    try {
      await execFileAsync(cmd[0], cmd.slice(1), { timeout: 10_000 });
      reloaded = true;
      reloadError = null;
      break;
    } catch (err) {
      reloadError = `${cmd.join(" ")}: ${(err as Error).message}`;
    }
  }

  // The cron daemon will pick up new files within ~1 minute even
  // without an explicit reload (cron rescans /etc/cron.d), so a
  // failed reload is a warning, not a fatal error. We still report
  // it via `error` so the operator can investigate.
  return {
    ok: true,
    path: cronPath,
    content,
    written: true,
    reloaded,
    error: reloaded ? null : `cron reload failed (file written; daemon will rescan within 1 min): ${reloadError}`,
    cadence,
  };
}
