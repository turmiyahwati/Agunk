import nodemailer, { type Transporter } from "nodemailer";
import { getBackupConfig, getSmtpPassword } from "./backup-config";

/**
 * Email helper for backup delivery.
 *
 * Uses Gmail SMTP by default (smtp.gmail.com:587 STARTTLS) but the
 * host/port/secure flags are configurable via the admin Backup &
 * Recovery panel — operators on a different provider (Resend SMTP,
 * Mailgun, custom domain, etc.) can point at any SMTP server.
 *
 * The transporter is rebuilt for every send so a config change in the
 * admin UI takes effect on the next backup without process restart.
 */

type SmtpProfile = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

async function buildTransporter(): Promise<Transporter> {
  const cfg = await getBackupConfig();
  const pass = await getSmtpPassword();
  if (!cfg.smtpUser || !pass) {
    throw new Error("SMTP credentials are not configured.");
  }
  const profile: SmtpProfile = {
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    user: cfg.smtpUser,
    pass,
  };
  return nodemailer.createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: { user: profile.user, pass: profile.pass },
    // Tighten timeouts so a misconfigured SMTP doesn't hang the
    // request thread for the default 60 seconds.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/**
 * Send a tiny "Hello from your dashboard" message — used by the
 * admin "Test email" button to validate SMTP credentials WITHOUT
 * triggering a full backup.
 */
export async function sendTestEmail(): Promise<{ ok: true; messageId: string }> {
  const cfg = await getBackupConfig();
  if (!cfg.emailRecipient) {
    throw new Error("Email recipient is not configured.");
  }
  const transporter = await buildTransporter();
  await transporter.verify();
  const result = await transporter.sendMail({
    from: cfg.smtpUser,
    to: cfg.emailRecipient,
    subject: "PT Sontoloyo Monitor — SMTP test",
    text:
      "This is a smoke-test email from your monitoring dashboard.\n\n" +
      "If you received this, your SMTP settings are configured correctly\n" +
      "and the next backup will be delivered to this inbox.\n\n" +
      `Sent at ${new Date().toISOString()}.`,
    html:
      `<p>This is a smoke-test email from your <strong>PT Sontoloyo Monitor</strong> dashboard.</p>` +
      `<p>If you received this, your SMTP settings are configured correctly and the next backup will be delivered to this inbox.</p>` +
      `<p style="color:#888">Sent at ${new Date().toISOString()}.</p>`,
  });
  return { ok: true, messageId: result.messageId };
}

/**
 * Send a backup tarball as a single attachment.
 *
 * The backup file is sent as-is — encryption (if configured) was
 * already applied by the backup script. Attachment is referenced by
 * absolute path so nodemailer streams it from disk without buffering
 * the whole file in memory (matters once backups exceed 5 MB).
 */
export async function sendBackupEmail(opts: {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  encrypted: boolean;
}): Promise<{ ok: true; messageId: string }> {
  const cfg = await getBackupConfig();
  if (!cfg.emailRecipient) {
    throw new Error("Email recipient is not configured.");
  }
  const transporter = await buildTransporter();

  const sizeKb = Math.round(opts.sizeBytes / 1024);
  const subject = `PT Sontoloyo Monitor — Backup ${opts.createdAt}`;
  const body =
    `Automatic backup from your monitoring dashboard.\n\n` +
    `  File       : ${opts.fileName}\n` +
    `  Size       : ${sizeKb} KB\n` +
    `  SHA-256    : ${opts.sha256}\n` +
    `  Encrypted  : ${opts.encrypted ? "yes (AES-256-CBC)" : "NO — plaintext"}\n` +
    `  Created    : ${opts.createdAt}\n\n` +
    (opts.encrypted
      ? "Decryption passphrase is NOT included in this email by design. Keep it in a separate location.\n"
      : "WARNING: this backup is NOT encrypted. Configure SONTOLOYO_BACKUP_PASSPHRASE on the dashboard for next time.\n");
  const html =
    `<p>Automatic backup from your <strong>PT Sontoloyo Monitor</strong> dashboard.</p>` +
    `<table style="border-collapse:collapse;font-family:monospace;font-size:13px">` +
    `<tr><td style="padding:4px 12px"><b>File</b></td><td>${opts.fileName}</td></tr>` +
    `<tr><td style="padding:4px 12px"><b>Size</b></td><td>${sizeKb} KB</td></tr>` +
    `<tr><td style="padding:4px 12px"><b>SHA-256</b></td><td>${opts.sha256}</td></tr>` +
    `<tr><td style="padding:4px 12px"><b>Encrypted</b></td><td>${
      opts.encrypted ? "yes (AES-256-CBC)" : "<span style='color:red'>NO — plaintext</span>"
    }</td></tr>` +
    `<tr><td style="padding:4px 12px"><b>Created</b></td><td>${opts.createdAt}</td></tr>` +
    `</table>` +
    (opts.encrypted
      ? `<p style="color:#666"><i>Decryption passphrase is NOT in this email by design. Keep it in a separate location.</i></p>`
      : `<p style="color:red"><b>WARNING:</b> this backup is NOT encrypted. Configure a backup passphrase in the dashboard for next time.</p>`);

  const result = await transporter.sendMail({
    from: cfg.smtpUser,
    to: cfg.emailRecipient,
    subject,
    text: body,
    html,
    attachments: [{ filename: opts.fileName, path: opts.filePath }],
  });
  return { ok: true, messageId: result.messageId };
}
