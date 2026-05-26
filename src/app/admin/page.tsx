"use client";
import { useEffect, useState } from "react";
import { Server as ServerIcon, Activity, Wifi, Users, AlertTriangle } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { useServers } from "@/hooks/useServers";
import { ServerCard } from "@/components/ServerCard";
import { Skeleton } from "@/components/ui/Skeleton";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 8000);

type Stats = {
  servers: { total: number; online: number; offline: number; full: number; warning: number };
  connections: { active: number; capacity: number };
};

export default function AdminOverview() {
  const { servers, loading } = useServers({ refreshMs: REFRESH_MS });
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const j = await fetch("/api/stats", { cache: "no-store" }).then((r) => r.json());
        if (alive) setStats(j);
      } catch {}
    };
    run();
    const t = setInterval(run, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const offline = stats?.servers.offline ?? 0;
  const full = stats?.servers.full ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <span className="neon-text">Admin</span> Overview
        </h1>
        <p className="text-sm text-slate-400">Statistik realtime seluruh fleet VPN/Xray.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ServerIcon}    label="Servers"     value={stats?.servers.total ?? 0}   tone="cyan"    live />
        <StatCard icon={Activity}      label="Online"      value={stats?.servers.online ?? 0}  tone="emerald" live />
        <StatCard icon={AlertTriangle} label="Warning"     value={stats?.servers.warning ?? 0} tone="yellow"  live />
        <StatCard icon={Wifi}          label="Full / Off"  value={`${full} / ${offline}`}      tone="rose" />
        <StatCard
          icon={Users}
          label="Active Connections"
          value={stats?.connections.active ?? 0}
          sub={stats?.connections.capacity ? `dari ${stats.connections.capacity.toLocaleString()} kapasitas slot` : undefined}
          tone="purple"
          live
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Live Server Grid</h2>
        {loading && !servers ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(servers || []).map((s) => (
              <ServerCard key={s.id} server={s} href={`/admin/servers?focus=${s.id}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
