"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCcw,
  Database,
  Mail,
  Upload,
  Save,
  AlertTriangle,
  KeyRound,
  CalendarClock,
} from "lucide-react";
import toast from "react-hot-toast";
import type { BackupConfig } from "@/lib/backup-config";
import type { BackupRecord } from "@/lib/backup";
import { StatusPanel } from "@/components/admin/backup/StatusPanel";
import { BackupHistoryTable } from "@/components/admin/backup/BackupHistoryTable";
import { UploadRestoreModal } from "@/components/admin/backup/UploadRestoreModal";

/**
 * Admin → Backup & Recovery page.
 *
 * Single-page operator console for the dashboard's backup lifecycle.
 * Polls /api/backup at most every 30s while the tab is visible — no
 * faster because backup state is human-cadence (cron is hourly).
 */
const POLL_MS = 30_000;

export default function BackupRecoveryPage() {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"idle" | "backup" | "test-email" | "cron">("idle");
  const [showUpload, setShowUpload] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/backup", { cache: "no-store", signal: ctrl.signal });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      if (!res.ok) throw new Error(j.error || "Fetch failed");
      setConfig(j.config);
      setBackups(j.backups);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      toast.error((err as Error).message);
    } finally {
      if (inflightRef.current === ctrl) inflightRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) refresh();
    }, POLL_MS);
    return () => {
      clearInterval(t);
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, [refresh]);

  async function backupNow() {
    setBusy("backup");
    const t = toast.loading("Running backup…");
    try {
      const res = await fetch("/api/backup/now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Backup failed");
      toast.success(
        `Backup ready · ${j.fileName?.slice(0, 40) || ""} · ${
          j.emailed ? "emailed" : "saved locally"
        }`,
        { id: t },
      );
      if (j.emailError) toast.error(`Email: ${j.emailError}`);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy("idle");
    }
  }

  async function testEmail() {
    setBusy("test-email");
    const t = toast.loading("Sending test email…");
    try {
      const res = await fetch("/api/backup/test-email", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Test failed");
      toast.success(`Test sent · message id ${(j.messageId as string)?.slice(0, 24)}…`, {
        id: t,
      });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy("idle");
    }
  }

  async function applyCron() {
    setBusy("cron");
    const t = toast.loading("Applying cron…");
    try {
      const res = await fetch("/api/backup/cron/apply", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        throw new Error(j.error || "Cron apply failed");
      }
      if (!j.reloaded) {
        toast.success(
          "Cron file written — daemon reload failed but cron rescans within 1 min.",
          { id: t },
        );
      } else {
        toast.success(`Cron applied · ${j.cadence}`, { id: t });
      }
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            <span className="neon-text">Backup</span> & Recovery
          </h1>
          <p className="text-sm text-slate-400">
            Encrypted snapshots of your dashboard state. Configure, trigger, archive, restore.
          </p>
        </div>
        <button
          onClick={refresh}
          className="btn-ghost text-xs"
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {config && <StatusPanel config={config} backups={backups} />}

      {/* Quick actions */}
      <div className="glass p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-200">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={backupNow}
            disabled={busy !== "idle"}
            className="btn-primary"
          >
            {busy === "backup" ? (
              <RefreshCcw size={14} className="animate-spin" />
            ) : (
              <Database size={14} />
            )}
            Backup Sekarang
          </button>
          <button
            type="button"
            onClick={testEmail}
            disabled={busy !== "idle" || !config?.emailEnabled || !config?.smtpPassSet}
            className="btn-ghost"
            title={
              !config?.emailEnabled || !config?.smtpPassSet
                ? "Configure SMTP below first"
                : "Send a small SMTP smoke-test email"
            }
          >
            {busy === "test-email" ? (
              <RefreshCcw size={14} className="animate-spin" />
            ) : (
              <Mail size={14} />
            )}
            Test Email
          </button>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            disabled={busy !== "idle"}
            className="btn-ghost"
          >
            <Upload size={14} />
            Upload &amp; Restore
          </button>
          <button
            type="button"
            onClick={applyCron}
            disabled={busy !== "idle"}
            className="btn-ghost"
            title="Rewrite /etc/cron.d/sontoloyo with the current backup interval and reload cron."
          >
            {busy === "cron" ? (
              <RefreshCcw size={14} className="animate-spin" />
            ) : (
              <CalendarClock size={14} />
            )}
            Apply Cron
          </button>
        </div>
      </div>

      {/* History */}
      <div className="glass p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-200">Backup History</h2>
        <BackupHistoryTable backups={backups} onMutate={refresh} />
      </div>

      {/* Settings */}
      {config && <SettingsForm config={config} onSaved={refresh} />}

      <UploadRestoreModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onDone={refresh}
      />
    </div>
  );
}

// ─── Settings form ────────────────────────────────────────────────────────

function SettingsForm({ config, onSaved }: { config: BackupConfig; onSaved: () => void }) {
  const [form, setForm] = useState({
    intervalHours: config.intervalHours,
    retentionDays: config.retentionDays,
    emailEnabled: config.emailEnabled,
    emailRecipient: config.emailRecipient,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    sendAfterBackup: config.sendAfterBackup,
  });
  const [passphrase, setPassphrase] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...form };
      if (passphrase !== "") body.passphrase = passphrase;
      if (smtpPass !== "") body.smtpPass = smtpPass;
      const res = await fetch("/api/backup/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      toast.success("Settings saved");

      // The PATCH attempts to rewrite /etc/cron.d/sontoloyo whenever
      // intervalHours changes. Surface the outcome so the operator
      // knows whether the OS-level schedule actually shifted —
      // saving the form alone is misleading otherwise.
      const cron = j.cron;
      if (cron) {
        if (cron.attempted) {
          if (cron.result.ok && cron.result.reloaded) {
            toast.success(`Cron auto-applied · ${cron.result.cadence}`);
          } else if (cron.result.ok && !cron.result.reloaded) {
            toast(
              "Cron file rewritten; daemon reload failed (will rescan within 1 min).",
              { icon: "⚠️" },
            );
          } else {
            toast.error(
              `Cron auto-apply failed: ${cron.result.error ?? "unknown error"}. Click "Apply Cron" to retry.`,
              { duration: 8_000 },
            );
          }
        } else {
          toast(
            `${cron.reason} — gunakan tombol "Apply Cron" setelah env diperbaiki.`,
            { icon: "ℹ️", duration: 7_000 },
          );
        }
      }

      setPassphrase("");
      setSmtpPass("");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-200">Settings</h2>

      {!config.passphraseSet && (
        <div className="mb-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-[12px] text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              No backup passphrase set yet — backups are stored as <strong>plaintext .tar.gz</strong>.
              Configure one below to enable AES-256-CBC encryption.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Auto-backup interval">
          <select
            className="input"
            value={form.intervalHours}
            onChange={(e) => set("intervalHours", Number(e.target.value))}
          >
            <option value={1}>Every 1 hour</option>
            <option value={3}>Every 3 hours (recommended)</option>
            <option value={6}>Every 6 hours</option>
            <option value={12}>Every 12 hours</option>
            <option value={24}>Every 24 hours</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Cron at /etc/cron.d/sontoloyo. Saved interval is auto-applied
            via "Apply Cron" — no installer re-run needed.
          </p>
        </Field>
        <Field label="Retention (days)">
          <input
            type="number"
            className="input"
            min={1}
            max={365}
            value={form.retentionDays}
            onChange={(e) => set("retentionDays", Number(e.target.value))}
          />
        </Field>

        <Field label="Backup passphrase (write-only)" hint="Used by AES-256-CBC. Empty = unchanged.">
          <div className="relative">
            <KeyRound
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="password"
              className="input pl-8"
              autoComplete="new-password"
              placeholder={config.passphraseSet ? "(passphrase is set — leave empty to keep)" : "Set a strong passphrase"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
        </Field>
        <Field label="Send after each backup">
          <Toggle
            checked={form.sendAfterBackup}
            onChange={(v) => set("sendAfterBackup", v)}
            label={form.sendAfterBackup ? "Email each new backup" : "Local-only (no email)"}
          />
        </Field>

        <div className="md:col-span-2 mt-2 border-t border-white/5 pt-4 text-xs uppercase tracking-wider text-slate-500">
          Email destination
        </div>

        <Field label="Email enabled">
          <Toggle
            checked={form.emailEnabled}
            onChange={(v) => set("emailEnabled", v)}
            label={form.emailEnabled ? "Active" : "Disabled"}
          />
        </Field>
        <Field label="Recipient">
          <input
            type="email"
            className="input"
            placeholder="admin@example.com"
            value={form.emailRecipient}
            onChange={(e) => set("emailRecipient", e.target.value)}
          />
        </Field>

        <Field label="SMTP host">
          <input
            className="input"
            value={form.smtpHost}
            onChange={(e) => set("smtpHost", e.target.value)}
          />
        </Field>
        <Field label="SMTP port">
          <input
            type="number"
            className="input"
            min={1}
            max={65535}
            value={form.smtpPort}
            onChange={(e) => set("smtpPort", Number(e.target.value))}
          />
        </Field>

        <Field label="Use SSL (port 465)" hint="Off for STARTTLS on 587 (Gmail default).">
          <Toggle
            checked={form.smtpSecure}
            onChange={(v) => set("smtpSecure", v)}
            label={form.smtpSecure ? "SSL/TLS" : "STARTTLS"}
          />
        </Field>
        <Field label="SMTP username">
          <input
            className="input"
            placeholder="your-gmail@example.com"
            value={form.smtpUser}
            onChange={(e) => set("smtpUser", e.target.value)}
          />
        </Field>

        <Field
          label="SMTP password (write-only)"
          hint='Gmail: enable 2FA, then "App passwords" → mail. Empty = unchanged.'
        >
          <div className="relative">
            <KeyRound
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="password"
              className="input pl-8"
              autoComplete="new-password"
              placeholder={config.smtpPassSet ? "(SMTP password is set — leave empty to keep)" : "App password from Gmail"}
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
            />
          </div>
        </Field>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
        checked
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : "border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full ${
          checked ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-500"
        }`}
      />
      {label || (checked ? "On" : "Off")}
    </button>
  );
}
