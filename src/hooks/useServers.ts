"use client";
import { useEffect, useState, useCallback } from "react";
import type { ServerSummary } from "@/components/ServerCard";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);

export function useServers(opts?: { refreshMs?: number }) {
  const refreshMs = opts?.refreshMs ?? REFRESH_MS;
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/servers/public", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Fetch failed");
      setServers(j.servers);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    const t = setInterval(fetchOnce, refreshMs);
    return () => clearInterval(t);
  }, [fetchOnce, refreshMs]);

  return { servers, error, loading, refresh: fetchOnce };
}
