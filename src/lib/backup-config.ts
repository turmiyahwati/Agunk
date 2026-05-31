import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto-util";

/**
 * Backup & Recovery configuration storage.
 *
 * All non-secret settings live in a single Setting row keyed
 * `backup_config` (JSON). Sensitive values (SMTP password, backup
 * passphrase) live in their own Setting rows under `secret:*` keys
 * encrypted via crypto-util.
 *
 * Why split? Two reasons:
 *   1. The non-secret JSON can be safely returned to the admin UI for
 *      display — secrets remain on the server side.
 *   2. Rotating one secret without touching the rest is trivial.
 */

const PUBLIC_KEY = "backup_config";
const SECRET_PASSPHRASE_KEY = "secret:backup_passphrase";
const SECRET_SMTP_PASS_KEY = "secret:smtp_pass";

export type BackupConfig = {
  /** Auto-backup interval in hours. UI offers 1, 3, 6, 12, 24. */
  intervalHours: number;
  /** Local + email retention in days. Older files are pruned. */
  retentionDays: number;
  /** Whether AES encryption + emailing is wired up. */
  passphraseSet: boolean;
  /** Email destination block. */
  emailEnabled: boolean;
  emailRecipient: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  /** True when an SMTP password is stored. The actual value never leaves the server. */
  smtpPassSet: boolean;
  /** Send each successful backup to email automatically. */
  sendAfterBackup: boolean;
  /** Last update timestamp, ISO-8601. Useful for audit. */
  updatedAt: string | null;
};

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  intervalHours: 3,
  retentionDays: 14,
  passphraseSet: false,
  emailEnabled: false,
  emailRecipient: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 587,
  smtpSecure: false, // STARTTLS on 587
  smtpUser: "",
  smtpPassSet: false,
  sendAfterBackup: true,
  updatedAt: null,
};

/**
 * Read the current public config. Always returns a complete object —
 * defaults are applied for any missing field so old DB rows from
 * earlier versions stay forward-compatible.
 */
export async function getBackupConfig(): Promise<BackupConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PUBLIC_KEY } });
    const passphraseRow = await prisma.setting.findUnique({
      where: { key: SECRET_PASSPHRASE_KEY },
    });
    const smtpPassRow = await prisma.setting.findUnique({
      where: { key: SECRET_SMTP_PASS_KEY },
    });
    let parsed: Partial<BackupConfig> = {};
    if (row?.value) {
      try {
        parsed = JSON.parse(row.value);
      } catch {
        parsed = {};
      }
    }
    return {
      ...DEFAULT_BACKUP_CONFIG,
      ...parsed,
      passphraseSet: !!passphraseRow?.value,
      smtpPassSet: !!smtpPassRow?.value,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  } catch {
    // Setting table may not exist on a fresh install — return defaults.
    return { ...DEFAULT_BACKUP_CONFIG };
  }
}

/**
 * Persist a partial config update. Merges with existing values so the
 * caller can update one field without re-supplying the rest.
 *
 * Sensitive fields (`passphrase`, `smtpPass`) are accepted as separate
 * arguments and routed to their own Setting rows.
 */
export async function updateBackupConfig(
  patch: Partial<Omit<BackupConfig, "passphraseSet" | "smtpPassSet" | "updatedAt">>,
  secrets?: { passphrase?: string | null; smtpPass?: string | null },
): Promise<BackupConfig> {
  const current = await getBackupConfig();
  const merged: BackupConfig = { ...current, ...patch };

  // Persist non-secret JSON.
  const json = JSON.stringify({
    intervalHours: merged.intervalHours,
    retentionDays: merged.retentionDays,
    emailEnabled: merged.emailEnabled,
    emailRecipient: merged.emailRecipient,
    smtpHost: merged.smtpHost,
    smtpPort: merged.smtpPort,
    smtpSecure: merged.smtpSecure,
    smtpUser: merged.smtpUser,
    sendAfterBackup: merged.sendAfterBackup,
  });
  await prisma.setting.upsert({
    where: { key: PUBLIC_KEY },
    update: { value: json },
    create: { key: PUBLIC_KEY, value: json },
  });

  // Secrets — only touch when caller supplies one. Empty string clears.
  if (secrets?.passphrase !== undefined) {
    if (secrets.passphrase === null || secrets.passphrase === "") {
      await prisma.setting
        .delete({ where: { key: SECRET_PASSPHRASE_KEY } })
        .catch(() => {});
    } else {
      const enc = encryptSecret(secrets.passphrase);
      await prisma.setting.upsert({
        where: { key: SECRET_PASSPHRASE_KEY },
        update: { value: enc },
        create: { key: SECRET_PASSPHRASE_KEY, value: enc },
      });
    }
  }
  if (secrets?.smtpPass !== undefined) {
    if (secrets.smtpPass === null || secrets.smtpPass === "") {
      await prisma.setting
        .delete({ where: { key: SECRET_SMTP_PASS_KEY } })
        .catch(() => {});
    } else {
      const enc = encryptSecret(secrets.smtpPass);
      await prisma.setting.upsert({
        where: { key: SECRET_SMTP_PASS_KEY },
        update: { value: enc },
        create: { key: SECRET_SMTP_PASS_KEY, value: enc },
      });
    }
  }

  return getBackupConfig();
}

/** Decrypt the stored passphrase, or null when not configured. */
export async function getBackupPassphrase(): Promise<string | null> {
  const row = await prisma.setting.findUnique({
    where: { key: SECRET_PASSPHRASE_KEY },
  });
  if (!row?.value) return null;
  try {
    return decryptSecret(row.value);
  } catch {
    return null;
  }
}

/** Decrypt the stored SMTP password, or null when not configured. */
export async function getSmtpPassword(): Promise<string | null> {
  const row = await prisma.setting.findUnique({
    where: { key: SECRET_SMTP_PASS_KEY },
  });
  if (!row?.value) return null;
  try {
    return decryptSecret(row.value);
  } catch {
    return null;
  }
}
