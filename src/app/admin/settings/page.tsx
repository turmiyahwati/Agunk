"use client";
import { useCallback, useEffect, useState } from "react";
import {
  RefreshCcw,
  KeyRound,
  Database,
  Terminal,
  Save,
  Clock,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import toast from "react-hot-toast";
import { setRuntimeCache } from "@/hooks/useRuntimeConfig";

type RuntimeConfig = {
  refreshMs: number;
  activityRefreshMs: number;
  updatedAt: string | null;
};

type CronApplyResponse = {
  ok: boolean;
  path: string;
  content: string;
  written: boolean;
  reloaded: boolean;
  error: string | null;
  cadence: string;
};

const PRESETS_REFRESH = [3_000, 5_000, 10_000, 15_000, 30_000, 60_000];
const PRESETS_ACTIVITY = [2_000, 3_000, 5_000, 10_000, 15_000, 30_000];

export default function SettingsPage() {
  const [busy, setBusy] = useState(false);

  // ─── Runtime polling config state ──────────────────────────────────────
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [refreshMs, setRefreshMsState] = useState<number>(10_000);
  const [activityRefreshMs, setActivityRefreshMsState] = useState<number>(5_000);
  const [savingConfig, setSavingConfig] = useState(false);

  // ─── Cron apply state ──────────────────────────────────────────────────
  const [cronBusy, setCronBusy] = useState(false);
  const [lastCron, setLastCron] = useState<CronApplyResponse | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/runtime-config", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Load failed");
      setConfig(j.config);
      setRefreshMsState(j.config.refreshMs);
      setActivityRefreshMsState(j.config.activityRefreshMs);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function syncNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/monitor/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      toast.success(`Synced ${j.ok}/${j.total}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRuntimeConfig() {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/runtime-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshMs, activityRefreshMs }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      setConfig(j.config);
      // Push to module-level cache so every other open tab page in
      // this session picks up the change without an extra round-trip.
      setRuntimeCache({
        refreshMs: j.config.refreshMs,
        activityRefreshMs: j.config.activityRefreshMs,
      });
      toast.success("Polling interval saved — UI will pick it up immediately.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingConfig(false);
    }
  }

  async function applyCron() {
    setCronBusy(true);
    const t = toast.loading("Applying cron…");
    try {
      const res = await fetch("/api/backup/cron/apply", { method: "POST" });
      const j: CronApplyResponse = await res.json();
      setLastCron(j);
      if (!res.ok || !j.ok) {
        toast.error(j.error || "Cron apply failed", { id: t });
      } else if (!j.reloaded) {
        toast.success(
          "Cron file written — reload failed but daemon will rescan within 1 min.",
          { id: t },
        );
      } else {
        toast.success(`Cron applied · ${j.cadence}`, { id: t });
      }
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setCronBusy(false);
    }
  }

  const dirty =
    config !== null &&
    (refreshMs !== config.refreshMs || activityRefreshMs !== config.activityRefreshMs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
        <p className="text-sm text-slate-400">Konfigurasi sistem monitoring.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card icon={<RefreshCcw size={16} />} title="Manual Sync">
          <p className="mb-3 text-sm text-slate-400">
            Tarik data dari semua VPS agent yang aktif sekarang.
          </p>
          <button onClick={syncNow} disabled={busy} className="btn-primary">
            <RefreshCcw size={14} className={busy ? "animate-spin" : ""} />
            Sync All Servers
          </button>
        </Card>

        <Card icon={<Terminal size={16} />} title="External Cron">
          <p className="text-sm text-slate-400">
            Pakai header <code className="text-cyan-300">X-Sync-Token</code>:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 text-xs">
{`*/1 * * * * curl -fsS \\
  -H "X-Sync-Token: $MONITOR_SYNC_TOKEN" \\
  -X POST https://your-domain/api/monitor/sync >/dev/null`}
          </pre>
        </Card>
      </div>

      {/* ── Runtime Polling Config ─────────────────────────────────────── */}
      <div className="glass p-5">
        <div className="mb-2 flex items-center gap-2 text-cyan-300">
          <Clock size={16} />
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            Polling Interval
          </h3>
          <span className="ml-auto text-[11px] text-slate-500">
            Live values — no rebuild required
          </span>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          Berlaku untuk dashboard publik dan admin. Berapa cepat browser
          re-poll <code className="text-cyan-300">/api/servers/public</code>{" "}
          dan <code className="text-cyan-300">/api/activity</code>. Nilai
          minimum 2 detik, maksimum 10 menit. Perubahan langsung dipakai oleh
          tab yang terbuka — tidak perlu edit{" "}
          <code className="text-cyan-300">.env</code> atau rebuild bundle.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <IntervalField
            label="Server / stats refresh"
            hint="Daftar server, kartu status, statistik global."
            valueMs={refreshMs}
            presets={PRESETS_REFRESH}
            onChange={setRefreshMsState}
          />
          <IntervalField
            label="Activity feed refresh"
            hint="Realtime activity log di homepage."
            valueMs={activityRefreshMs}
            presets={PRESETS_ACTIVITY}
            onChange={setActivityRefreshMsState}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4">
          <div className="text-[11px] text-slate-500">
            {config?.updatedAt
              ? `Last saved: ${new Date(config.updatedAt).toLocaleString()}`
              : "Defaults dari NEXT_PUBLIC_REFRESH_MS / NEXT_PUBLIC_ACTIVITY_REFRESH_MS"}
          </div>
          <button
            onClick={saveRuntimeConfig}
            disabled={savingConfig || !dirty}
            className="btn-primary"
          >
            {savingConfig ? (
              <RefreshCcw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {dirty ? "Save Polling Interval" : "Saved"}
          </button>
        </div>
      </div>

      {/* ── Apply Cron ─────────────────────────────────────────────────── */}
      <div className="glass p-5">
        <div className="mb-2 flex items-center gap-2 text-cyan-300">
          <CalendarClock size={16} />
          <h3 className="text-sm font-semibold uppercase tracking-wider">
            Apply Cron
          </h3>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Tulis ulang <code className="text-cyan-300">/etc/cron.d/sontoloyo</code>
          {" "}berdasarkan setting saat ini (sync per menit + backup interval
          dari Backup & Recovery). Operasi idempotent — aman dipanggil
          berkali-kali. Membutuhkan akses tulis ke{" "}
          <code className="text-cyan-300">/etc/cron.d</code> (production:
          dashboard process berjalan sebagai root).
        </p>

        <button onClick={applyCron} disabled={cronBusy} className="btn-primary">
          {cronBusy ? (
            <RefreshCcw size={14} className="animate-spin" />
          ) : (
            <CalendarClock size={14} />
          )}
          Apply Cron Now
        </button>

        {lastCron && (
          <div className="mt-4 space-y-2">
            <CronStatusLine result={lastCron} />
            <details className="rounded-lg border border-white/10 bg-black/40 text-xs">
              <summary className="cursor-pointer px-3 py-2 text-slate-300">
                Show rendered cron file
              </summary>
              <pre className="overflow-x-auto px-3 pb-3 pt-1 text-[11px] text-slate-300">
{lastCron.content || "(empty)"}
              </pre>
            </details>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card icon={<KeyRound size={16} />} title="Environment">
          <ul className="space-y-1 text-sm text-slate-300">
            <li><span className="text-slate-400">DATABASE_URL</span> — koneksi DB (SQLite/Postgres)</li>
            <li><span className="text-slate-400">NEXTAUTH_SECRET</span> — secret JWT</li>
            <li><span className="text-slate-400">MONITOR_SYNC_TOKEN</span> — token cron</li>
            <li>
              <span className="text-slate-400">NEXT_PUBLIC_REFRESH_MS</span> —
              fallback polling interval (override-able dari UI di atas)
            </li>
            <li><span className="text-slate-400">NEXT_PUBLIC_WHATSAPP_NUMBER</span> — nomor admin (homepage)</li>
            <li><span className="text-slate-400">NEXT_PUBLIC_BRAND_NAME</span> — nama brand di header</li>
          </ul>
        </Card>

        <Card icon={<Database size={16} />} title="VPS Agent">
          <p className="text-sm text-slate-400">
            Install di setiap VPS, lalu daftarkan URL + API key di halaman Servers.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 text-xs">
{`# di VPS Debian/Ubuntu:
cd /tmp && git clone https://github.com/<your-org>/<repo>.git agent
cd agent/vps-agent && sudo bash install.sh
# ikuti README: vps-agent/README.md`}
          </pre>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function IntervalField({
  label,
  hint,
  valueMs,
  presets,
  onChange,
}: {
  label: string;
  hint: string;
  valueMs: number;
  presets: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              p === valueMs
                ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100"
                : "border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/[0.05]"
            }`}
          >
            {formatMs(p)}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          className="input w-32"
          min={2_000}
          max={600_000}
          step={500}
          value={valueMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        <span className="text-xs text-slate-500">ms</span>
        <span className="text-xs text-slate-400">= {formatMs(valueMs)}</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function CronStatusLine({ result }: { result: CronApplyResponse }) {
  if (result.ok && result.reloaded) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-[12px] text-emerald-200">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <div>
          Cron written to <code>{result.path}</code> · cadence {result.cadence} ·
          cron daemon reloaded successfully.
        </div>
      </div>
    );
  }
  if (result.ok && !result.reloaded) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-[12px] text-amber-200">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div>
          Cron file written to <code>{result.path}</code> tetapi reload daemon
          gagal. Tidak fatal — cron rescans /etc/cron.d setiap menit.
          {result.error && (
            <div className="mt-1 font-mono text-[10px] text-amber-300/80">
              {result.error}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.04] p-3 text-[12px] text-rose-200">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div>
        Cron apply failed. Path: <code>{result.path}</code>
        {result.error && (
          <div className="mt-1 font-mono text-[10px] text-rose-300/80">
            {result.error}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass p-5">
      <div className="mb-2 flex items-center gap-2 text-cyan-300">
        {icon}
        <h3 className="text-sm font-semibold uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms % 1_000 === 0 ? 0 : 1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1_000);
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}
