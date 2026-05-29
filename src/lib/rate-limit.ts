/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window per IP address.
 *
 * NOTE: This works per-process. In a multi-instance deployment (e.g. multiple
 * PM2 workers), each process has its own store. For production at scale,
 * consider Redis-backed rate limiting. For a single-VPS deployment this is
 * perfectly adequate.
 */

import { NextResponse } from "next/server";

type Entry = { count: number; resetAt: number };

const stores = new Map<string, Map<string, Entry>>();

export interface RateLimitConfig {
  /** Unique identifier for this limiter (e.g. "auth-login") */
  id: string;
  /** Max requests allowed within the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Extract client IP from request headers.
 * Supports Cloudflare's CF-Connecting-IP, X-Forwarded-For (nginx/proxy),
 * and X-Real-IP, with safe fallback.
 */
function getClientIP(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }
  const realIP = req.headers.get("x-real-ip");
  if (realIP) return realIP.trim();
  return "unknown";
}

/**
 * Check and consume a rate limit token.
 */
export function rateLimit(req: Request, config: RateLimitConfig): RateLimitResult {
  const { id, maxRequests, windowSec } = config;

  if (!stores.has(id)) {
    stores.set(id, new Map());
  }
  const store = stores.get(id)!;

  const ip = getClientIP(req);
  const now = Date.now();
  const entry = store.get(ip);

  // Cleanup expired entries periodically (~1% of checks)
  if (Math.random() < 0.01) {
    for (const [key, val] of store.entries()) {
      if (now > val.resetAt) store.delete(key);
    }
  }

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: maxRequests - 1, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, retryAfterSec: 0 };
}

/**
 * Convenience wrapper. Returns null when allowed; returns a 429 NextResponse
 * when not. Designed for use at the top of route handlers:
 *
 *   const limited = enforceRateLimit(req, PUBLIC_API_LIMIT);
 *   if (limited) return limited;
 */
export function enforceRateLimit(req: Request, config: RateLimitConfig) {
  const r = rateLimit(req, config);
  if (r.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

// ─── Pre-configured presets ────────────────────────────────────────────

/**
 * Login attempts. 5 per 60 seconds per IP.
 * Pairs with the per-email throttle inside `lib/auth.ts` for defense in depth.
 */
export const LOGIN_LIMIT: RateLimitConfig = {
  id: "auth-login",
  maxRequests: 5,
  windowSec: 60,
};

/**
 * Public read APIs (homepage stats, server list, activity, branding,
 * homepage content, protocols, server metrics).
 * 90 / minute / IP — generous for legitimate polling, caps abuse.
 */
export const PUBLIC_API_LIMIT: RateLimitConfig = {
  id: "public-api",
  maxRequests: 90,
  windowSec: 60,
};

/**
 * Admin write/sync operations. Already authenticated via requireAdmin,
 * but we still IP-rate-limit to prevent runaway clients.
 */
export const WRITE_LIMIT: RateLimitConfig = {
  id: "admin-write",
  maxRequests: 30,
  windowSec: 60,
};

/**
 * External cron / monitor sync trigger.
 *
 * Was 6/min — but a per-minute cron + admin manual button + multiple admin
 * tabs all hit the same IP and 6 was too tight (caused 429 in normal ops).
 * 30/min keeps brute-force scrapers out while leaving headroom for legitimate
 * use including occasional retries.
 */
export const SYNC_LIMIT: RateLimitConfig = {
  id: "monitor-sync",
  maxRequests: 30,
  windowSec: 60,
};
