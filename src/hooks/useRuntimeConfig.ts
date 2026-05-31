"use client";
import { useEffect, useState } from "react";

/**
 * Client-side runtime polling config hook.
 *
 * Why a custom hook (and not, say, SWR or context)?
 *   - Five different consumers (admin overview, public homepage,
 *     server detail, server-list hook, activity log) each want the
 *     same two numbers — fetching five times is wasteful.
 *   - We deliberately keep this dependency-free: a tiny module-level
 *     cache + subscriber set is enough, and avoids dragging in SWR
 *     or React Query just for a single 200-byte JSON document.
 *   - First mount: kick off one fetch, every other mount within the
 *     same page session reads from cache. After the admin saves a
 *     new value via Settings, `setRuntimeCache()` is called to push
 *     the new numbers into every live subscriber instantly — no need
 *     to wait for the next interval re-fetch.
 *
 * SSR safety: during server render `cached` is null, so we return the
 * env-baked defaults. Hydration replaces them once the first effect
 * runs in the browser.
 */

export type RuntimeConfigClient = {
  refreshMs: number;
  activityRefreshMs: number;
};

// Env values are read at build time and serve as the floor / fallback
// before any /api/runtime-config response lands. Matches the legacy
// behaviour from PR #22 so anyone who hasn't visited the new Settings
// page gets the same cadence as before.
export const ENV_DEFAULTS: RuntimeConfigClient = {
  refreshMs: clampMs(Number(process.env.NEXT_PUBLIC_REFRESH_MS) || 10_000),
  activityRefreshMs: clampMs(Number(process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS) || 5_000),
};

function clampMs(n: number): number {
  if (!Number.isFinite(n) || n < 2_000) return 10_000;
  if (n > 600_000) return 600_000;
  return Math.round(n);
}

let cached: RuntimeConfigClient | null = null;
let inflight: Promise<RuntimeConfigClient> | null = null;
type Listener = (cfg: RuntimeConfigClient) => void;
const listeners = new Set<Listener>();

async function fetchOnce(): Promise<RuntimeConfigClient> {
  if (typeof window === "undefined") return ENV_DEFAULTS;
  try {
    const res = await fetch("/api/runtime-config", { cache: "no-store" });
    if (!res.ok) throw new Error(`runtime-config ${res.status}`);
    const j = await res.json();
    const c = j?.config ?? {};
    const out: RuntimeConfigClient = {
      refreshMs: clampMs(Number(c.refreshMs) || ENV_DEFAULTS.refreshMs),
      activityRefreshMs: clampMs(
        Number(c.activityRefreshMs) || ENV_DEFAULTS.activityRefreshMs,
      ),
    };
    cached = out;
    return out;
  } catch {
    cached = ENV_DEFAULTS;
    return ENV_DEFAULTS;
  }
}

/**
 * React hook returning the current runtime polling cadence.
 * Re-renders when the global cache changes (e.g. after Admin → Settings save).
 */
export function useRuntimeConfig(): RuntimeConfigClient {
  const [config, setConfig] = useState<RuntimeConfigClient>(cached ?? ENV_DEFAULTS);

  useEffect(() => {
    const listener: Listener = (c) => setConfig(c);
    listeners.add(listener);

    if (cached) {
      setConfig(cached);
    } else {
      if (!inflight) inflight = fetchOnce().finally(() => { inflight = null; });
      inflight.then((c) => {
        listener(c);
      }).catch(() => {});
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return config;
}

/**
 * Push a new config into the cache and notify all subscribers. Call
 * this after a successful PATCH /api/runtime-config so the same admin
 * tab updates immediately instead of waiting for the next page load.
 */
export function setRuntimeCache(c: Partial<RuntimeConfigClient>) {
  const base = cached ?? ENV_DEFAULTS;
  const next: RuntimeConfigClient = {
    refreshMs: clampMs(Number(c.refreshMs) || base.refreshMs),
    activityRefreshMs: clampMs(Number(c.activityRefreshMs) || base.activityRefreshMs),
  };
  cached = next;
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* listener crashed — skip */ }
  });
}
