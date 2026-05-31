import { prisma } from "./prisma";

/**
 * Runtime-editable polling configuration.
 *
 * Historically the dashboard read its polling cadence from
 * `NEXT_PUBLIC_REFRESH_MS` and `NEXT_PUBLIC_ACTIVITY_REFRESH_MS` —
 * which are baked into the client bundle at build time. That meant
 * every cadence tweak required:
 *
 *   1. SSH into the VPS
 *   2. Edit `.env`
 *   3. `npm run build` + `pm2 reload`
 *
 * This module turns those values into a runtime setting served from
 * `/api/runtime-config`. The env vars stay supported as the *default*
 * (so existing deployments keep working) but the operator can now
 * override them from Admin → Settings without rebuild + SSH.
 *
 * Storage: a single Setting row at key `runtime_config` containing a
 * JSON blob. We deliberately reuse the existing Setting key/value
 * table rather than introducing a new model — no migration needed.
 */

const KEY = "runtime_config";

export type RuntimeConfig = {
  /** Server-list / stats polling cadence in ms. UI: 2000 — 600000. */
  refreshMs: number;
  /** Activity-feed polling cadence in ms. UI: 2000 — 600000. */
  activityRefreshMs: number;
  /** Last update timestamp, ISO-8601. Useful for audit. */
  updatedAt: string | null;
};

/** Hard bounds. The UI clamps to these so an admin can't accidentally
 *  set 0 (busy-loop) or 1ms (DDoS yourself) or 24h (effectively off). */
export const MIN_REFRESH_MS = 2_000;
export const MAX_REFRESH_MS = 600_000;

/** Defaults fall back to env first, then to the built-in 10s/5s. The
 *  env fallback preserves the existing v1.x deploys' behaviour even
 *  before the operator visits the new Settings page. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  refreshMs: clamp(Number(process.env.NEXT_PUBLIC_REFRESH_MS) || 10_000),
  activityRefreshMs: clamp(Number(process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS) || 5_000),
  updatedAt: null,
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 10_000;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, Math.round(n)));
}

/**
 * Read the current runtime config. Always returns a complete object —
 * defaults are applied for any missing field so old DB rows stay
 * forward-compatible. Out-of-range values from a hand-edited DB row
 * are clamped silently.
 */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    let parsed: Partial<RuntimeConfig> = {};
    if (row?.value) {
      try {
        parsed = JSON.parse(row.value);
      } catch {
        parsed = {};
      }
    }
    return {
      refreshMs: clamp(Number(parsed.refreshMs) || DEFAULT_RUNTIME_CONFIG.refreshMs),
      activityRefreshMs: clamp(
        Number(parsed.activityRefreshMs) || DEFAULT_RUNTIME_CONFIG.activityRefreshMs,
      ),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  } catch {
    // Setting table may not exist on a fresh install — return defaults.
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

/**
 * Persist a partial config update. Merges with existing values so the
 * caller can update one field without re-supplying the rest.
 *
 * Validation: each numeric field is clamped to [MIN_REFRESH_MS,
 * MAX_REFRESH_MS]. Non-numeric / NaN inputs reuse the existing value.
 */
export async function updateRuntimeConfig(
  patch: Partial<Omit<RuntimeConfig, "updatedAt">>,
): Promise<RuntimeConfig> {
  const current = await getRuntimeConfig();
  const merged: RuntimeConfig = {
    refreshMs: patch.refreshMs !== undefined ? clamp(Number(patch.refreshMs)) : current.refreshMs,
    activityRefreshMs:
      patch.activityRefreshMs !== undefined
        ? clamp(Number(patch.activityRefreshMs))
        : current.activityRefreshMs,
    updatedAt: current.updatedAt,
  };

  const json = JSON.stringify({
    refreshMs: merged.refreshMs,
    activityRefreshMs: merged.activityRefreshMs,
  });

  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: json },
    create: { key: KEY, value: json },
  });

  return getRuntimeConfig();
}
