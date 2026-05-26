"use client";
import { useState } from "react";
import { RefreshCcw, KeyRound, Database, Terminal } from "lucide-react";
import toast from "react-hot-toast";

export default function SettingsPage() {
  const [busy, setBusy] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/monitor/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sync failed");
      toast.success(`Synced ${j.ok}/${j.total}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

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

        <Card icon={<KeyRound size={16} />} title="Environment">
          <ul className="space-y-1 text-sm text-slate-300">
            <li><span className="text-slate-400">DATABASE_URL</span> — koneksi DB (SQLite/Postgres)</li>
            <li><span className="text-slate-400">NEXTAUTH_SECRET</span> — secret JWT</li>
            <li><span className="text-slate-400">MONITOR_SYNC_TOKEN</span> — token cron</li>
            <li><span className="text-slate-400">NEXT_PUBLIC_REFRESH_MS</span> — interval polling FE</li>
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

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
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
