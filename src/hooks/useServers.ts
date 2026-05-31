"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { ServerSummary } from "@/components/ServerCard";
import { shouldPoll } from "@/lib/utils";

const REFRESH_MS = Number(process.env.NEXT_PUBLIC_REFRESH_MS || 10000);

/**
 * Server list polling hook.
 *
 * - Polls /api/servers/public every `refreshMs` (default 10s) ONLY when the
 *   tab is visible — saves CPU, network and mobile battery.
 * - Refetches immediately when the user brings the tab back to focus.
 * - Cancels the in-flight request via AbortController on unmount or when
 *   a fresh fetch is initiated. This prevents the dreaded "setState on
 *   unmounted component" warning during spam-refresh, and stops a
 *   previous slow response from clobbering a newer one.
 */
export function useServers(opts?: { refreshMs?: number }) {
  const refreshMs = opts?.refreshMs ?? REFRESH_MS;
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inflightRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/servers/public", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      if (!res.ok) throw new Error(j.error || "Fetch failed");
      setServers(j.servers);
      setError(null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Fetch failed");
    } finally {
      if (inflightRef.current === ctrl) inflightRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnce();
    const t = setInterval(() => {
      if (shouldPoll()) fetchOnce();
    }, refreshMs);
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) fetchOnce();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      clearInterval(t);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, [fetchOnce, refreshMs]);

  return { servers, error, loading, refresh: fetchOnce };
}
