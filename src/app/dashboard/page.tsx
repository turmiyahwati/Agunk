"use client";
import { useMemo, useState } from "react";
import { Search, Globe, Server as ServerIcon, Users, Activity, Wifi } from "lucide-react";
import { useServers } from "@/hooks/useServers";
import { ServerCard } from "@/components/ServerCard";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";

export default function MemberDashboard() {
  const { servers, loading } = useServers();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("ALL");
  const [provider, setProvider] = useState("ALL");

  const countries = useMemo(
    () => Array.from(new Set((servers || []).map((s) => s.countryName))).sort(),
    [servers],
  );
  const providers = useMemo(
    () => Array.from(new Set((servers || []).map((s) => s.provider))).sort(),
    [servers],
  );

  const filtered = useMemo(() => {
    return (servers || []).filter((s) => {
      if (country !== "ALL" && s.countryName !== country) return false;
      if (provider !== "ALL" && s.provider !== provider) return false;
      if (q && !`${s.name} ${s.domain} ${s.countryName} ${s.provider}`.toLowerCase().includes(q.toLowerCase()))
        return false;
      return true;
    });
  }, [servers, q, country, provider]);

  const stats = useMemo(() => {
    const arr = servers || [];
    return {
      total: arr.length,
      online: arr.filter((s) => s.status === "ONLINE" || s.status === "WARNING").length,
      offline: arr.filter((s) => s.status === "OFFLINE").length,
      full: arr.filter((s) => s.status === "FULL").length,
      activeUsers: arr.reduce((a, s) => a + (s.activeUsers || 0), 0),
      totalSlot: arr.reduce((a, s) => a + (s.maxSlot || 0), 0),
    };
  }, [servers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <span className="neon-text">Network</span> Overview
        </h1>
        <p className="text-sm text-slate-400">Realtime status semua server VPN/Xray.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={ServerIcon} label="Total Server" value={stats.total} tone="cyan" />
        <StatCard icon={Activity}   label="Online"       value={stats.online}  sub={`${stats.offline} offline`} tone="emerald" />
        <StatCard icon={Wifi}       label="Full Slot"    value={stats.full}    tone="yellow" />
        <StatCard icon={Users}      label="Active Users" value={stats.activeUsers} sub={`/ ${stats.totalSlot} slot`} tone="purple" />
      </div>

      <div className="glass flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari server, domain, provider..."
            className="input pl-9"
          />
        </div>
        <select className="input md:w-48" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="ALL">Semua negara</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input md:w-48" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="ALL">Semua provider</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading && !servers ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass grid place-items-center p-16 text-center">
          <Globe className="mb-3 text-slate-500" size={32} />
          <div className="font-medium">Tidak ada server cocok</div>
          <p className="mt-1 text-sm text-slate-400">Coba ubah filter atau kata kunci pencarian.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <ServerCard key={s.id} server={s} href={`/dashboard/servers/${s.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
