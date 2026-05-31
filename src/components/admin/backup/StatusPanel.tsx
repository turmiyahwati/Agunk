"use client";
import { Database, Mail, Lock, Shield, Clock, HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { BackupConfig } from "@/lib/backup-config";
import type { BackupRecord } from "@/lib/backup";

/**
 * Top-of-page summary card on the Backup & Recovery admin route.
 *
 * Shows operator-relevant state at a glance:
 *   • last backup time + size
 *   • next scheduled backup (computed from cron interval)
 *   • encryption status (passphrase present in DB?)
 *   • email destination configured?
 *   • how many backups currently stored locally
 *
 * Pure presentation — every field is derived from the props the
 * server already returns from /api/backup. No additional fetches here.
 */
export function StatusPanel({
  config,
  backups,
}: {
  config: BackupConfig;
  backups: BackupRecord[];
}) {
  const last = backups[0];
  const totalBytes = backups.reduce((acc, b) => acc + b.size, 0);
  const avgBytes = backups.length > 0 ? totalBytes / backups.length : 0;

  // Crude next-run estimate. Cron handles the real timing on the
  // server; this is just to give the admin a rough idea — accurate
  // within +/- one polling cycle of the dashboard.
  const nextRun =
    last && config.intervalHours > 0
      ? new Date(new Date(last.createdAt).getTime() + config.intervalHours * 60 * 60_000)
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card
        icon={Clock}
        tone="cyan"
        label="Last backup"
        value={last ? formatRelative(last.createdAt) : "—"}
        sub={last ? formatLocal(last.createdAt) : "no backups yet"}
      />
      <Card
        icon={Clock}
        tone="purple"
        label="Next backup (~)"
        value={nextRun ? formatRelative(nextRun.toISOString()) : "—"}
        sub={`every ${config.intervalHours}h via cron`}
      />
      <Card
        icon={Lock}
        tone={config.passphraseSet ? "emerald" : "rose"}
        label="Encryption"
        value={config.passphraseSet ? "AES-256-CBC" : "DISABLED"}
        sub={config.passphraseSet ? "passphrase set" : "set passphrase below"}
      />
      <Card
        icon={Mail}
        tone={config.emailEnabled && config.smtpPassSet ? "emerald" : "slate"}
        label="Email delivery"
        value={config.emailEnabled ? config.emailRecipient || "—" : "off"}
        sub={
          config.emailEnabled
            ? config.smtpPassSet
              ? `via ${config.smtpHost}`
              : "SMTP password missing"
            : "configure below"
        }
      />
      <Card
        icon={HardDrive}
        tone="cyan"
        label="Stored backups"
        value={`${backups.length}`}
        sub={`avg ${formatBytes(avgBytes)} · total ${formatBytes(totalBytes)}`}
      />
      <Card
        icon={Shield}
        tone="purple"
        label="Retention"
        value={`${config.retentionDays} days`}
        sub="auto-pruned by cron"
      />
    </div>
  );
}

function Card({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  // Match the rest of the codebase (Sidebar.tsx, Tile in detail page) —
  // lucide-react components are forward-refs, easier to keep the type
  // permissive than fight the variance.
  icon: React.ComponentType<any>;
  tone: "cyan" | "purple" | "emerald" | "rose" | "slate";
  label: string;
  value: string;
  sub?: string;
}) {
  const tones: Record<string, string> = {
    cyan:    "from-cyan-400/15 to-cyan-400/0 text-cyan-300 border-cyan-300/20",
    purple:  "from-purple-500/15 to-purple-500/0 text-purple-300 border-purple-500/20",
    emerald: "from-emerald-400/15 to-emerald-400/0 text-emerald-300 border-emerald-300/20",
    rose:    "from-rose-400/15 to-rose-400/0 text-rose-300 border-rose-300/20",
    slate:   "from-white/[0.04] to-white/0 text-slate-400 border-white/10",
  };
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 ${tones[tone]}`}>
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
        <Icon size={13} />
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}

function formatLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((t - now) / 1000);
  const abs = Math.abs(sec);
  const future = sec > 0;
  if (abs < 60) return future ? "in <1 min" : "just now";
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return future ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(abs / 86400);
  return future ? `in ${d}d` : `${d}d ago`;
}
