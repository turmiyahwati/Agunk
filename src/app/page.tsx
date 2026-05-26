"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Globe, Server as ServerIcon, Activity, Wifi, Users, PowerOff, RefreshCcw } from "lucide-react";
import { useServers } from "@/hooks/useServers";
import { ServerCard } from "@/components/ServerCard";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { PublicHeader } from "@/components/PublicHeader";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { ActivityLog } from "@/components/ActivityLog";
import { ProtocolInfo } from "@/components/ProtocolInfo";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "PT Sontoloyo";
const AUTHOR = process.env.NEXT_PUBLIC_AUTHOR || "Pakde Xresx Digital Store";
const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);
const REFRESH_COOLDOWN_MS = 2500;

type Stats = {
  servers: { total: number; online: number; offline: number; full: number; warning: number };
  connections: { active: number; capacity: number };
};

export default function PublicMonitoring() {
  const { servers, loading, refresh: refreshServers } = useServers();
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("ALL");
  const [provider, setProvider] = useState("ALL");

  // Manual-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [activityNonce, setActivityNonce] = useState(0);
  const cooldownUntilRef = useRef(0);

  // Stats fetcher — reused by the polling effect AND the refresh button.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const j = await res.json();
      setStats(j);
    } catch {}
  }, []);

  // Realtime stats polling
  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchStats]);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    if (Date.now() < cooldownUntilRef.current) return;
    setRefreshing(true);
    try {
      await Promise.allSettled([fetchStats(), refreshServers()]);
      setActivityNonce((n) => n + 1);
    } finally {
      cooldownUntilRef.current = Date.now() + REFRESH_COOLDOWN_MS;
      setRefreshing(false);
    }
  }, [refreshing, fetchStats, refreshServers]);

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

  return (
    <div className="min-h-screen">
      <PublicHeader />

      <main className="container mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
        <WelcomeBanner />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={ServerIcon} label="Total Server" value={stats?.servers.total ?? 0} tone="cyan" live />
          <StatCard icon={Activity}   label="Online"       value={stats?.servers.online ?? 0} tone="emerald" live />
          <StatCard icon={Wifi}       label="Full Slot"    value={stats?.servers.full ?? 0} tone="yellow" />
          <StatCard icon={PowerOff}   label="Offline"      value={stats?.servers.offline ?? 0} tone="rose" />
          <StatCard
            icon={Users}
            label="Active Connections"
            value={stats?.connections.active ?? 0}
            sub={stats?.connections.capacity ? `dari ${stats.connections.capacity.toLocaleString()} kapasitas slot` : undefined}
            tone="purple"
            live
          />
        </div>

        <div className="glass flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari server, lokasi, provider..."
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
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="btn-ghost whitespace-nowrap text-xs disabled:cursor-not-allowed"
            title="Refresh statistik & daftar server"
            aria-label="Refresh server data"
          >
            <RefreshCcw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Memperbarui..." : "Refresh Server"}
          </button>
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
              <ServerCard key={s.id} server={s} href={`/servers/${s.id}`} />
            ))}
          </div>
        )}

        <ActivityLog refreshNonce={activityNonce} />

        <ProtocolInfo />

        <footer className="border-t border-white/5 pt-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} {BRAND} — Built by {AUTHOR}.
        </footer>
      </main>
    </div>
  );
}
