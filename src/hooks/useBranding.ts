"use client";
import { useCallback, useEffect, useState } from "react";

const BRANDING_EVENT = "agunk:branding-updated";

/**
 * Fetches the current logo URL from /api/branding.
 *
 * - Refetches on mount.
 * - Refetches when window regains focus (so admin → public realtime feels live).
 * - Refetches on a custom "branding-updated" event broadcast on the same tab
 *   right after the admin saves a new logo.
 */
export function useBranding() {
  const [logo, setLogo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/branding", { cache: "no-store" });
      const j = await res.json();
      setLogo(j?.logo ?? null);
    } catch {
      setLogo(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onCustom = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(BRANDING_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(BRANDING_EVENT, onCustom);
    };
  }, [refresh]);

  return { logo, loaded, refresh };
}

/** Admin pages call this after a successful upload/reset. */
export function broadcastBrandingUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BRANDING_EVENT));
  }
}
