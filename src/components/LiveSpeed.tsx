"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Activity, Download, Upload, RefreshCcw } from "lucide-react";

/**
 * Browser-side live download/upload speedtest.
 *
 * Runs a real network transfer between the visitor's browser and the
 * agent (via the public Cloudflare Tunnel hostname), giving the visitor
 * a measurement of THEIR connection speed to the server — exactly the
 * marketing pitch every VPN reseller wants to show on the homepage.
 *
 * Bandwidth budget is the most expensive part of the public dashboard,
 * so this component is heavily guarded:
 *
 *  1. **Lazy-start**: never runs until the host card is visible in the
 *     viewport (IntersectionObserver). A visitor who never scrolls past
 *     the hero never burns bandwidth on cards they don't see.
 *  2. **Session cache**: the result is stored in sessionStorage for 5
 *     minutes — back/forward navigation or scroll-up scroll-down won't
 *     re-test.
 *  3. **Auto-test only ONCE**: subsequent updates require the user to
 *     click "Test Again". We optimize for the "first impression"
 *     conversion shot, not continuous benchmarking.
 *  4. **Tunable size**: defaults to 2 MB download + 1 MB upload (about
 *     10 seconds total on a 3 Mbps line). Operators can crank this
 *     down via env to save bandwidth on busy days.
 *  5. **Aborts cleanly** on unmount.
 *
 * When ``host`` is falsy the component shows the ``fallbackMbps`` from
 * the agent's server-side throughput sample (already monthly-averaged)
 * so the card never looks broken.
 */

const DOWNLOAD_BYTES = Math.max(
  100_000,
  Number(process.env.NEXT_PUBLIC_SPEEDTEST_DOWNLOAD_BYTES || 2_000_000),
);
const UPLOAD_BYTES = Math.max(
  100_000,
  Number(process.env.NEXT_PUBLIC_SPEEDTEST_UPLOAD_BYTES || 1_000_000),
);
const CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.NEXT_PUBLIC_SPEEDTEST_CACHE_MS || 5 * 60 * 1000),
);
const AUTO_RUN =
  (process.env.NEXT_PUBLIC_SPEEDTEST_AUTO ?? "true").toLowerCase() !== "false";

type Result = { download: number; upload: number; ts: number };

function readCache(host: string): Result | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`speedtest:${host}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Result;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(host: string, r: Result) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`speedtest:${host}`, JSON.stringify(r));
  } catch {
    /* private mode, quota exceeded, etc. */
  }
}

async function measureDownload(host: string, bytes: number, signal: AbortSignal) {
  const url = `https://${host}/api/probe/download?bytes=${bytes}&_=${Date.now()}`;
  const t0 = performance.now();
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const dt = (performance.now() - t0) / 1000;
  if (dt <= 0) return 0;
  // Mbps = bits / 1e6 / seconds
  return (blob.size * 8) / 1_000_000 / dt;
}

async function measureUpload(host: string, bytes: number, signal: AbortSignal) {
  const url = `https://${host}/api/probe/upload?_=${Date.now()}`;
  // Generate the payload once outside the timer so we measure transfer
  // time only, not allocation time. crypto.getRandomValues prevents
  // intermediary compression skewing the result.
  const payload = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    // crypto.getRandomValues caps at 65536 bytes per call on most browsers.
    for (let off = 0; off < bytes; off += 65536) {
      crypto.getRandomValues(payload.subarray(off, Math.min(off + 65536, bytes)));
    }
  }
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    body: payload,
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.text();
  const dt = (performance.now() - t0) / 1000;
  if (dt <= 0) return 0;
  return (bytes * 8) / 1_000_000 / dt;
}

function LiveSpeedImpl({
  host,
  fallbackMbps,
}: {
  host?: string | null;
  fallbackMbps?: number | null;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const runTest = useCallback(async () => {
    if (!host || busy) return;
    setBusy(true);
    setError(false);
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    try {
      const download = await measureDownload(host, DOWNLOAD_BYTES, ctrl.signal);
      const upload = await measureUpload(host, UPLOAD_BYTES, ctrl.signal);
      const r: Result = { download, upload, ts: Date.now() };
      if (!ctrl.signal.aborted) {
        setResult(r);
        writeCache(host, r);
      }
    } catch {
      if (!ctrl.signal.aborted) setError(true);
    } finally {
      if (!ctrl.signal.aborted) setBusy(false);
    }
  }, [host, busy]);

  // Hydrate from session cache on mount.
  useEffect(() => {
    if (!host) {
      setResult(null);
      return;
    }
    const cached = readCache(host);
    if (cached) setResult(cached);
  }, [host]);

  // Auto-run once the card scrolls into view, but only if no cache.
  useEffect(() => {
    if (!host || !AUTO_RUN || startedRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      startedRef.current = true;
      runTest();
      return;
    }
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            // Defer briefly so the page is fully painted before we
            // start hammering the network — produces a more honest
            // measurement on slow CPUs.
            setTimeout(() => {
              if (!readCache(host)) runTest();
            }, 250);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [host, runTest]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const fmt = (mbps: number) =>
    !isFinite(mbps) || mbps <= 0
      ? "—"
      : mbps < 10
        ? `${mbps.toFixed(1)}`
        : `${Math.round(mbps)}`;

  return (
    <div ref={containerRef} className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-2">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300/80">
          <Download size={11} /> Download
        </div>
        <div className="font-mono text-sm text-slate-100">
          {result ? `${fmt(result.download)} Mb` : busy ? "Testing…" : fallbackMbps ? `${fmt(fallbackMbps)} Mb` : "—"}
        </div>
      </div>
      <div className="rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/5 p-2">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fuchsia-300/80">
          <Upload size={11} /> Upload
        </div>
        <div className="font-mono text-sm text-slate-100">
          {result ? `${fmt(result.upload)} Mb` : busy ? "Testing…" : "—"}
        </div>
      </div>
      {host && (
        <div className="col-span-2 mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Activity size={10} className={busy ? "animate-pulse text-cyan-300" : ""} />
            {error ? "Test gagal — coba lagi" : busy ? "Mengukur dari browser Anda…" : result ? "Diukur dari browser Anda" : ""}
          </span>
          <button
            type="button"
            onClick={runTest}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
            title="Jalankan ulang speedtest"
          >
            <RefreshCcw size={10} className={busy ? "animate-spin" : ""} />
            {busy ? "Test…" : "Test"}
          </button>
        </div>
      )}
    </div>
  );
}

export const LiveSpeed = memo(LiveSpeedImpl);
