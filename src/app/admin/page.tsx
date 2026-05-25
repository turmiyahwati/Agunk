"use client";
import { useEffect, useState } from "react";
import { Server as ServerIcon, Activity, Wifi, Users, AlertTriangle } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { useServers } from "@/hooks/useServers";
import { ServerCard } from "@/components/ServerCard";
import { Skeleton } from "@/components/ui/Skeleton";

type Stats = {
  servers: { total: number; online: number; offline: number; full: number; warning: number };
  users: { activeOnVPN: number; totalSlot: number; members: number };
};

export default function AdminOverview() {
  const { servers, loading } = useServers({ refreshMs: 8000 });
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const run = async () => {
      const j = await fetch("/api/stats", { cache: "no-store" }).then((r) => r.json());
      setStats(j);
    };
    run();
    const t = setInterval(run, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <span className="neon-text">Admin</span> Overview
        </h1>
        <p className="text-sm text-slate-400">Statistik realtime semua server & member.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ServerIcon}    label="Servers"     value={stats?.servers.total ?? "—"} tone="cyan" />
        <StatCard icon={Activity}      label="Online"      value={stats?.servers.online ?? "—"} tone="emerald" />
        <StatCard icon={AlertTriangle} label="Warning"     value={stats?.servers.warning ?? "—"} tone="yellow" />
        <StatCard icon={Wifi}          label="Full / Off"  value={`${stats?.servers.full ?? "—"} / ${stats?.servers.offline ?? "—"}`} tone="rose" />
        <StatCard icon={Users}         label="Members"     value={stats?.users.members ?? "—"} sub={`${stats?.users.activeOnVPN ?? 0} online VPN`} tone="purple" />
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
