"use client";
import { memo, useEffect, useRef, useState } from "react";
import { Wifi } from "lucide-react";

/**
 * Browser-side live ping probe.
 *
 * Repeatedly fetches the agent's `/health` endpoint over the public
 * Cloudflare Tunnel hostname and measures the round-trip time. Updates
 * every ``intervalMs`` (default 2.5 s) so the visitor sees a true
 * realtime number — the latency THEY experience from THEIR network to
 * the server, not the dashboard's server-side ping.
 *
 * Properties:
 *  - Pauses when the browser tab is hidden (saves bandwidth and battery)
 *  - Cleans up inflight requests on unmount (no leaks on route change)
 *  - Falls back to the ``fallback`` prop after 3 consecutive failures —
 *    most commonly when the visitor's network blocks cross-origin probes
 *  - Tiny payload (<200 B per probe) so a 24 hour browse-session costs
 *    ~5 MB worst case
 */
function LivePingImpl({
  host,
  fallback,
  intervalMs = 2500,
  className,
}: {
  /** Public hostname (e.g. `agent-id1.example.com`). When falsy we render the fallback only. */
  host?: string | null;
  /** Server-side ping (ms) to display when host is unset or probes fail. */
  fallback?: number | null;
  /** Probe cadence in ms. */
  intervalMs?: number;
  className?: string;
}) {
  const [ms, setMs] = useState<number | null>(null);
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!host) {
      setMs(null);
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    const url = `https://${host}/health`;

    async function probeOnce() {
      if (!alive) return;
      if (typeof document !== "undefined" && document.hidden) {
        // Skip while tab is hidden but keep the loop alive — saves
        // bandwidth on background tabs that the visitor leaves open.
        timer = setTimeout(probeOnce, intervalMs);
        return;
      }
      const controller = new AbortController();
      inflight = controller;
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const t0 = performance.now();
      try {
        // `cache: "no-store"` prevents the browser from short-circuiting
        // the request when the server returns the same JSON twice.
        const res = await fetch(`${url}?_=${Date.now()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Drain the body so the response is actually received before
        // we stop the clock — without this the timer would only count
        // the headers round-trip on slow connections.
        await res.text();
        const dt = Math.max(1, Math.round(performance.now() - t0));
        if (alive) {
          setMs(dt);
          failuresRef.current = 0;
        }
      } catch {
        failuresRef.current += 1;
        if (alive && failuresRef.current >= 3) {
          // Stop showing stale data once the network is clearly down.
          setMs(null);
        }
      } finally {
        clearTimeout(timeoutId);
        if (alive) timer = setTimeout(probeOnce, intervalMs);
      }
    }

    probeOnce();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (inflight) inflight.abort();
    };
  }, [host, intervalMs]);

  const display =
    ms != null
      ? `${ms} ms`
      : fallback != null && fallback > 0
        ? `${fallback} ms`
        : "—";

  const live = ms != null;

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono ${className ?? ""}`}
      title={live ? "Realtime ping dari browser Anda" : "Server-side ping (browser probe unavailable)"}
    >
      <Wifi size={12} className={live ? "text-emerald-400" : "text-slate-500"} />
      {display}
    </span>
  );
}

export const LivePing = memo(LivePingImpl);
