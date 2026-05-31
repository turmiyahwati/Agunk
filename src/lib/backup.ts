import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { sha256 } from "./crypto-util";
import { getBackupConfig, getBackupPassphrase } from "./backup-config";
import { sendBackupEmail } from "./email";

/**
 * Backup orchestrator.
 *
 * Wraps the existing `scripts/backup-all.sh` and `scripts/restore.sh`
 * shell scripts so the admin UI can drive them. Keeping the shell
 * scripts as the source of truth means cron and the UI run identical
 * code paths.
 */

const BACKUP_DIR = process.env.SONTOLOYO_BACKUP_DIR || "/root/sontoloyo-backups";
const INSTALL_DIR = process.env.SONTOLOYO_INSTALL_DIR || "/root/sontoloyo-monitor";
const BACKUP_SCRIPT = path.join(INSTALL_DIR, "scripts", "backup-all.sh");
const RESTORE_SCRIPT = path.join(INSTALL_DIR, "scripts", "restore.sh");

/**
 * Verify the helper shell scripts exist before attempting to run them.
 * They live in this same repo (introduced in PR #20 — auto installer +
 * disaster recovery) — but a fresh clone that hasn't pulled the latest
 * main branch yet would crash with a confusing "spawn ENOENT" error.
 * This pre-check surfaces a clear "you need to update your repo" hint
 * to the operator instead.
 */
async function ensureScriptsExist(): Promise<void> {
  try {
    await Promise.all([
      fs.access(BACKUP_SCRIPT),
      fs.access(RESTORE_SCRIPT),
    ]);
  } catch {
    throw new Error(
      "Backup helper scripts not found at scripts/backup-all.sh and " +
        "scripts/restore.sh. Pull the latest main branch (`git pull`) " +
        "and reload PM2.",
    );
  }
}

// Quarantine area where uploaded backups land before they are validated
// and (optionally) applied. Lives under /tmp so a server reboot wipes
// it — no orphaned uploads accumulate.
const UPLOAD_DIR = "/tmp/sontoloyo-uploads";

// Maximum decompressed size we accept for an uploaded backup. Realistic
// backups are <10 MB even for 50 servers; 200 MB is a generous ceiling
// that catches accidental zip-bomb uploads without being too tight.
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

// Path entries we accept inside an uploaded archive. Anything else is
// rejected — defends against `../etc/shadow` style overwrites.
const ALLOWED_PATHS_RE =
  /^(?:prod\.db|env|manifest\.json|uploads(?:\/|$)|ssl\/(?:origin\.pem|origin\.key)|nginx\/sontoloyo\.conf)$/;

export type BackupRecord = {
  /** Filename, e.g. `sontoloyo-backup-host-20260531T170000Z.tar.gz.enc`. */
  name: string;
  /** Bytes on disk. */
  size: number;
  /** ISO-8601 mtime — when the backup was finalized. */
  createdAt: string;
  /** True when filename ends with `.enc`. */
  encrypted: boolean;
  /** "auto" | "manual". Best-effort — derived from filename or external state. */
  source: "auto" | "manual";
  /** SHA-256 of the file. Lazily computed. */
  sha256?: string;
};

/**
 * List backup files on disk, newest first. Cheap stat-based scan;
 * sha256 is NOT computed here (it's expensive — only computed
 * on-demand when an admin clicks Download/Email).
 */
export async function listBackups(): Promise<BackupRecord[]> {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const entries = await fs.readdir(BACKUP_DIR);
    const out: BackupRecord[] = [];
    for (const name of entries) {
      if (!/^sontoloyo-backup-.*\.tar\.gz(\.enc)?$/.test(name)) continue;
      const full = path.join(BACKUP_DIR, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        out.push({
          name,
          size: st.size,
          createdAt: st.mtime.toISOString(),
          encrypted: name.endsWith(".enc"),
          // Filename does not encode source — we approximate from
          // .last-source marker if present; otherwise default "auto".
          source: "auto",
        });
      } catch {
        // skip unreadable entries
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  } catch {
    return [];
  }
}

/** Resolve a backup name to its full on-disk path, with safety check. */
export function resolveBackupPath(name: string): string {
  if (!/^sontoloyo-backup-[A-Za-z0-9._-]+\.tar\.gz(\.enc)?$/.test(name)) {
    throw new Error("Invalid backup name");
  }
  const full = path.resolve(BACKUP_DIR, name);
  if (!full.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
    throw new Error("Backup path traversal blocked");
  }
  return full;
}

/**
 * Compute SHA-256 of a backup file. Cached to a sidecar `.sha256`
 * file so repeated UI requests don't re-hash a 600 KB file every
 * page load. Cache invalidates automatically when the backup file
 * mtime changes.
 */
export async function computeSha256(name: string): Promise<string> {
  const full = resolveBackupPath(name);
  const sidecar = full + ".sha256";
  try {
    const [st, sideSt] = await Promise.all([
      fs.stat(full),
      fs.stat(sidecar).catch(() => null),
    ]);
    if (sideSt && sideSt.mtime >= st.mtime) {
      const content = await fs.readFile(sidecar, "utf8");
      const hash = content.trim().split(/\s+/)[0];
      if (/^[a-f0-9]{64}$/i.test(hash)) return hash;
    }
    const buf = await fs.readFile(full);
    const hash = sha256(buf);
    await fs.writeFile(sidecar, `${hash}  ${name}\n`).catch(() => {});
    return hash;
  } catch (err) {
    throw new Error(`computeSha256 failed: ${(err as Error).message}`);
  }
}

/**
 * Trigger a fresh backup by spawning `scripts/backup-all.sh`. Streams
 * stdout/stderr back to the caller via a Promise so the admin UI can
 * surface diagnostic output if the script fails.
 *
 * The script reads its passphrase + retention from .env; the only
 * extra env var we set here is `SONTOLOYO_BACKUP_SOURCE=manual` so
 * the resulting record can be tagged in the history table.
 */
export async function runBackup(opts?: { source?: "auto" | "manual" }): Promise<{
  ok: boolean;
  output: string;
  filePath?: string;
}> {
  await ensureScriptsExist();
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  // Snapshot existing files BEFORE the run so we can identify the new one.
  const before = new Set(
    (await fs.readdir(BACKUP_DIR)).filter((f) =>
      /^sontoloyo-backup-.*\.tar\.gz(\.enc)?$/.test(f),
    ),
  );

  const env = {
    ...process.env,
    SONTOLOYO_BACKUP_SOURCE: opts?.source ?? "manual",
  };

  const result = await new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn("/bin/bash", [BACKUP_SCRIPT], {
      cwd: INSTALL_DIR,
      env,
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b.toString()));
    child.stderr.on("data", (b) => (output += b.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
    child.on("error", (err) => resolve({ code: -1, output: String(err) }));
  });

  if (result.code !== 0) {
    return { ok: false, output: result.output };
  }

  // Find the new file.
  const after = (await fs.readdir(BACKUP_DIR)).filter((f) =>
    /^sontoloyo-backup-.*\.tar\.gz(\.enc)?$/.test(f),
  );
  const fresh = after.find((f) => !before.has(f));
  const filePath = fresh ? path.join(BACKUP_DIR, fresh) : undefined;
  return { ok: true, output: result.output, filePath };
}

/**
 * Run the backup, then optionally email it. Returns the new file
 * record + email status so the UI can render a single result block.
 */
export async function runBackupAndOptionallyEmail(opts: {
  source: "auto" | "manual";
  forceEmail?: boolean;
}): Promise<{
  ok: boolean;
  output: string;
  fileName?: string;
  size?: number;
  sha256?: string;
  encrypted?: boolean;
  emailed?: boolean;
  emailError?: string;
}> {
  const r = await runBackup({ source: opts.source });
  if (!r.ok || !r.filePath) {
    return { ok: false, output: r.output };
  }
  const name = path.basename(r.filePath);
  const stat = await fs.stat(r.filePath);
  const hash = await computeSha256(name);
  const encrypted = name.endsWith(".enc");

  const cfg = await getBackupConfig();
  let emailed = false;
  let emailError: string | undefined;
  if (opts.forceEmail || (cfg.emailEnabled && cfg.sendAfterBackup)) {
    if (!cfg.emailEnabled || !cfg.emailRecipient) {
      emailError = "Email is disabled or recipient is empty.";
    } else {
      try {
        await sendBackupEmail({
          filePath: r.filePath,
          fileName: name,
          sizeBytes: stat.size,
          sha256: hash,
          createdAt: stat.mtime.toISOString(),
          encrypted,
        });
        emailed = true;
      } catch (err) {
        emailError = (err as Error).message;
      }
    }
  }

  return {
    ok: true,
    output: r.output,
    fileName: name,
    size: stat.size,
    sha256: hash,
    encrypted,
    emailed,
    emailError,
  };
}

// ─── Upload + restore ─────────────────────────────────────────────────────

/**
 * Persist an uploaded blob into the quarantine directory under a
 * unique session id and return the on-disk path. The caller is
 * expected to follow up with `validateUpload(sessionId)` and
 * eventually `applyRestore(sessionId)`.
 */
export async function stashUpload(
  fileName: string,
  body: ReadableStream<Uint8Array> | Buffer,
): Promise<{ sessionId: string; filePath: string; size: number }> {
  if (!/^[A-Za-z0-9._-]+\.tar\.gz(\.enc)?$/.test(fileName)) {
    throw new Error("Invalid filename");
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = path.join(UPLOAD_DIR, sessionId);
  await fs.mkdir(dir, { mode: 0o700 });
  const filePath = path.join(dir, fileName);

  // Stream to disk so we never buffer the entire 100 MB upload in memory.
  const fd = await fs.open(filePath, "w");
  try {
    if (Buffer.isBuffer(body)) {
      await fd.writeFile(body);
    } else {
      const reader = body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) await fd.write(value);
      }
    }
  } finally {
    await fd.close();
  }
  const stat = await fs.stat(filePath);
  return { sessionId, filePath, size: stat.size };
}

/**
 * Sweep stale upload sessions older than 1 hour. Called opportunistically
 * before each new upload so the quarantine dir does not balloon.
 */
export async function pruneStaleUploads(): Promise<void> {
  try {
    const entries = await fs.readdir(UPLOAD_DIR);
    const cutoff = Date.now() - 60 * 60_000;
    for (const name of entries) {
      const dir = path.join(UPLOAD_DIR, name);
      try {
        const st = await fs.stat(dir);
        if (st.mtimeMs < cutoff) {
          await fs.rm(dir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // dir doesn't exist yet — nothing to prune
  }
}

/**
 * Look up an upload session and return its file path. Throws if the
 * session id is not a recognised format or the session has expired.
 */
export async function findUploadFile(sessionId: string): Promise<string> {
  if (!/^\d{10,}-[A-Za-z0-9]{6,}$/.test(sessionId)) {
    throw new Error("Invalid session id");
  }
  const dir = path.join(UPLOAD_DIR, sessionId);
  const entries = await fs.readdir(dir);
  if (entries.length === 0) throw new Error("Upload session is empty");
  return path.join(dir, entries[0]);
}

/**
 * Validate an uploaded archive and return its manifest summary.
 *
 * Steps:
 *   1. Decrypt if filename ends with `.enc` (uses operator-supplied
 *      passphrase, falling back to the stored backup passphrase).
 *   2. Stream-parse the tar listing; reject any entry that:
 *        a. has a parent-dir traversal segment (`..`),
 *        b. is an absolute path,
 *        c. is not in the allowlist.
 *      Track decompressed size; abort if it exceeds MAX_DECOMPRESSED_BYTES.
 *   3. Extract `manifest.json` only; parse + return summary.
 *
 * The validated archive stays in the quarantine dir until the admin
 * either confirms restore or cancels.
 */
export async function validateUpload(opts: {
  sessionId: string;
  passphrase?: string | null;
}): Promise<{
  ok: true;
  fileName: string;
  encrypted: boolean;
  size: number;
  manifest: unknown;
}> {
  const file = await findUploadFile(opts.sessionId);
  const fileName = path.basename(file);
  const encrypted = fileName.endsWith(".enc");
  const stat = await fs.stat(file);

  // 1. Decrypt if needed → produces a sibling .tar.gz file we can read.
  let archivePath = file;
  if (encrypted) {
    const pass =
      opts.passphrase ??
      (await getBackupPassphrase()) ??
      process.env.SONTOLOYO_BACKUP_PASSPHRASE ??
      null;
    if (!pass) {
      throw new Error("Encrypted archive requires a passphrase.");
    }
    const decryptedPath = file.replace(/\.enc$/, "");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "openssl",
        [
          "enc",
          "-d",
          "-aes-256-cbc",
          "-pbkdf2",
          "-iter",
          "100000",
          "-in",
          file,
          "-out",
          decryptedPath,
          "-pass",
          `pass:${pass}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("Decryption failed — wrong passphrase?"));
      });
      child.on("error", reject);
    });
    archivePath = decryptedPath;
  }

  // 2. Stream-parse the tar listing for path validation. We use the
  //    `tar` npm package's listing mode so we never have to fork
  //    /usr/bin/tar (portability) and so we get cancellable streams.
  const tarMod = await import("tar");
  let totalDecompressed = 0;
  const entries: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const list = (tarMod as unknown as { list: (opts: object) => NodeJS.WritableStream }).list({
      file: archivePath,
      gzip: true,
      onentry: (entry: { path: string; size: number; type: string }) => {
        const p = entry.path.replace(/^\.\//, "");
        if (p.includes("..") || path.isAbsolute(p)) {
          reject(new Error(`Refusing entry with traversal: ${p}`));
          return;
        }
        if (!ALLOWED_PATHS_RE.test(p)) {
          reject(new Error(`Refusing unexpected entry: ${p}`));
          return;
        }
        totalDecompressed += entry.size;
        if (totalDecompressed > MAX_DECOMPRESSED_BYTES) {
          reject(new Error("Archive too large after decompression"));
          return;
        }
        entries.push(p);
      },
    });
    list.on("end", () => resolve());
    list.on("error", reject);
  });

  if (!entries.includes("manifest.json")) {
    throw new Error("Archive is missing manifest.json");
  }

  // 3. Extract just the manifest into memory.
  const tarMod2 = await import("tar");
  let manifestBuf = Buffer.alloc(0);
  await new Promise<void>((resolve, reject) => {
    const x = (
      tarMod2 as unknown as { extract: (o: object) => NodeJS.WritableStream }
    ).extract({
      file: archivePath,
      gzip: true,
      filter: (p: string) => p.replace(/^\.\//, "") === "manifest.json",
      onentry: (entry: NodeJS.ReadableStream) => {
        entry.on("data", (chunk: Buffer) => {
          manifestBuf = Buffer.concat([manifestBuf, chunk]);
        });
      },
    });
    x.on("end", () => resolve());
    x.on("error", reject);
  });

  let manifest: unknown = null;
  try {
    manifest = JSON.parse(manifestBuf.toString("utf8"));
  } catch {
    manifest = null;
  }

  return {
    ok: true,
    fileName,
    encrypted,
    size: stat.size,
    manifest: manifest ?? { warning: "manifest.json could not be parsed" },
  };
}

/**
 * Apply a previously-validated upload by handing it to
 * `scripts/restore.sh`. The shell script does the heavy lifting
 * (atomic file swaps, before-restore snapshots, pm2 reload).
 *
 * We pass the passphrase as an env var rather than as an argument so
 * it never appears in `ps` listings.
 */
export async function applyRestore(opts: {
  sessionId: string;
  passphrase?: string | null;
}): Promise<{ ok: boolean; output: string }> {
  await ensureScriptsExist();
  const file = await findUploadFile(opts.sessionId);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SONTOLOYO_RESTORE_YES: "1", // skip terminal prompt
  };
  if (opts.passphrase) {
    env.SONTOLOYO_BACKUP_PASSPHRASE = opts.passphrase;
  }
  const result = await new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn("/bin/bash", [RESTORE_SCRIPT, file], {
      cwd: INSTALL_DIR,
      env,
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b.toString()));
    child.stderr.on("data", (b) => (output += b.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
    child.on("error", (err) => resolve({ code: -1, output: String(err) }));
  });
  return { ok: result.code === 0, output: result.output };
}

/**
 * Stream a backup file as a NodeJS Readable. Used by the download
 * route — avoids loading the entire file into memory.
 */
export function readBackupStream(name: string): { stream: Readable; size: Promise<number> } {
  const full = resolveBackupPath(name);
  const stream = createReadStream(full);
  const size = fs.stat(full).then((s) => s.size);
  return { stream, size };
}

/**
 * Delete a backup file (and its sha256 sidecar). Used by admin UI.
 */
export async function deleteBackup(name: string): Promise<void> {
  const full = resolveBackupPath(name);
  await fs.unlink(full).catch(() => {});
  await fs.unlink(full + ".sha256").catch(() => {});
}

export const BACKUP_LIMITS = {
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024, // 100 MB hard ceiling on upload
  MAX_DECOMPRESSED_BYTES,
};
