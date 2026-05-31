import crypto from "crypto";

/**
 * Symmetric encryption utility for sensitive values stored in the
 * `Setting` table (SMTP password, backup passphrase, etc).
 *
 * The encryption key is derived from `NEXTAUTH_SECRET` so we do NOT
 * have to introduce yet another env var the operator has to manage.
 * Trade-off: rotating NEXTAUTH_SECRET also invalidates all stored
 * secrets — that's a deliberate fail-safe (rotating one secret
 * forces re-entry of the others, which catches misconfigured
 * deploys early).
 *
 * Ciphertext format (JSON-stringified):
 *
 *   {
 *     "v": 1,                          // schema version
 *     "iv": "<base64 12 bytes>",       // GCM nonce
 *     "tag": "<base64 16 bytes>",      // auth tag
 *     "ct": "<base64 ciphertext>"      // encrypted payload
 *   }
 *
 * AES-256-GCM provides authenticated encryption — tampering is
 * detected (decrypt throws), so we do not need a separate HMAC.
 */

const SALT = "sontoloyo-settings-v1"; // arbitrary fixed salt; key derivation is deterministic
const KEY_LEN = 32;                    // 256-bit AES key

let _cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "NEXTAUTH_SECRET is missing or too short — required to encrypt settings.",
    );
  }
  // scryptSync is intentionally CPU-expensive (≈100 ms here) — we cache
  // the result for the process lifetime so per-call cost is negligible.
  _cachedKey = crypto.scryptSync(secret, SALT, KEY_LEN);
  return _cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encryptSecret expects a string");
  }
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  });
}

export function decryptSecret(blob: string): string {
  let parsed: { v?: number; iv?: string; tag?: string; ct?: string };
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new Error("decryptSecret: invalid encrypted blob (not JSON)");
  }
  if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.ct) {
    throw new Error("decryptSecret: unsupported blob version or fields");
  }
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(parsed.ct, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/**
 * Compute the SHA-256 of an arbitrary buffer. Used for backup file
 * integrity checks shown to admins in the UI.
 */
export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
