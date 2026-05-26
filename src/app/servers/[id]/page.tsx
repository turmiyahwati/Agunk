"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Cpu, MemoryStick, Wifi, Activity, Server, Globe } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { PublicHeader } from "@/components/PublicHeader";
import { flagUrl, formatBytes, formatUptime, slotPercent, shouldPoll } from "@/lib/utils";
import type { ServerSummary } from "@/components/ServerCard";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);

type Detail = ServerSummary & {
  cpuPercent: number; ramPercent: number;
  sshActive: boolean; xrayActive: boolean; nginxActive: boolean; udpActive: boolean;
  totalSsh: number; totalXray: number;
};
type MetricPoint = {
  ts: string;
  activeUsers: number; pingMs: number; cpuPercent: number; ramPercent: number;
};

/**
 * Public detail page for a single server.
 *
 * The `domain` field is empty when the public API decides to hide the real
 * hostname. We treat any falsy or already-masked value as "hidden" and skip
 * rendering the Endpoint row entirely so visitors can not learn the real
 * VPS address.
 */
function isDomainVisible(d: string | undefined | null): d is string {
  return !!d && d !== "*.*.internal";
}

export default function PublicServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<Detail | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/servers/public", { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/servers/${id}/metrics?limit=60`, { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        const found = (a.servers as Detail[]).find((s) => s.id === id) || null;
        setServer(found);
        setMetrics(b.metrics || []);
      } catch {}
    }
    load();
    const t = setInterval(() => {
      if (shouldPoll()) load();
    }, REFRESH_MS);
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) load();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      alive = false;
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [id]);

  if (!server) {
    return (
      <div className="min-h-screen">
        <PublicHeader />
        <main className="container mx-auto max-w-7xl space-y-4 px-3 py-5 sm:px-4 md:px-6 md:py-8">
          <Skeleton className="h-12 w-64" />
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-72" />
        </main>
      </div>
    );
  }

  const pct = slotPercent(server.activeUsers, server.maxSlot);
  const showDomain = isDomainVisible(server.domain);

  return (
    <div className="min-h-screen">
      <PublicHeader />

      <main className="container mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-4 sm:space-y-6 md:px-6 md:py-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-300">
          <ArrowLeft size={14} /> Kembali ke daftar server
        </Link>

        <div className="glass relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-gradient-to-br from-cyan-400/15 to-purple-500/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            <div className="relative h-12 w-16 overflow-hidden rounded-md ring-1 ring-white/10">
              <Image src={server.flag || flagUrl(server.country)} alt={server.country} fill sizes="64px" className="object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight">{server.name}</h1>
              <div className="text-xs text-slate-400">
                {server.countryName} · {server.provider}
                {showDomain && (
                  <> · <span className="font-mono">{server.domain}</span></>
                )}
              </div>
            </div>
            <StatusBadge status={server.status} />
          </div>
        </div>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Tile icon={Cpu}         label="CPU"   value={`${server.cpuPercent.toFixed(0)}%`} bar={server.cpuPercent} />
          <Tile icon={MemoryStick} label="RAM"   value={`${server.ramPercent.toFixed(0)}%`} bar={server.ramPercent} />
          <Tile icon={Wifi}        label="Ping"  value={server.pingMs ? `${server.pingMs} ms` : "—"} />
          <Tile icon={Activity}    label="Speed" value={server.speedMbps ? `${server.speedMbps} Mb/s` : "—"} />
        </div>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          <div className="glass p-5 md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">User Aktif (history)</h3>
              <span className="text-xs text-slate-400">{metrics.length} samples</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <XAxis dataKey="ts" hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(34,211,238,0.3)", borderRadius: 12, color: "#e2e8f0" }}
                    labelFormatter={(v) => new Date(v).toLocaleTimeString()}
                  />
                  <Line type="monotone" dataKey="activeUsers" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="pingMs"      stroke="#a855f7" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass p-5">
            <h3 className="mb-3 font-semibold">Slot</h3>
            <div className="text-3xl font-bold">{server.activeUsers}<span className="text-base text-slate-400">/{server.maxSlot}</span></div>
            <div className="mt-1 text-xs text-slate-400">{pct}% terpakai</div>
            <div className="mt-3"><ProgressBar value={pct} /></div>

            <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
              <Service label="SSH"   ok={server.sshActive}   />
              <Service label="XRAY"  ok={server.xrayActive}  />
              <Service label="NGINX" ok={server.nginxActive} />
              <Service label="UDP"   ok={server.udpActive}   />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          {showDomain && (
            <KV icon={<Globe size={14} />} label="Endpoint" value={<span className="font-mono">{server.domain}</span>} />
          )}
          <KV icon={<Server size={14} />}   label="Uptime"   value={formatUptime(server.uptimeSec)} />
          <KV icon={<Activity size={14} />} label="Traffic"  value={`RX ${formatBytes(server.rxBytes)} · TX ${formatBytes(server.txBytes)}`} />
          <KV label="Provider" value={server.provider} />
        </div>
      </main>
    </div>
  );
}

function Tile({ icon: Icon, label, value, bar }: { icon: any; label: string; value: string; bar?: number }) {
  return (
    <div className="glass p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
        <Icon size={16} className="text-cyan-300" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {typeof bar === "number" && <div className="mt-2"><ProgressBar value={bar} /></div>}
    </div>
  );
}

function Service({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${ok ? "border-emerald-400/20 bg-emerald-400/5" : "border-rose-400/20 bg-rose-400/5"}`}>
      <span className="text-slate-300">{label}</span>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-rose-400 shadow-[0_0_10px_#fb7185]"}`} />
    </div>
  );
}

function KV({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="glass p-4">
      <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400">
        {icon} {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
