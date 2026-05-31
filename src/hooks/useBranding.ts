"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const BRANDING_EVENT = "agunk:branding-updated";

/**
 * Fetches the current logo URL from /api/branding.
 *
 * - Refetches on mount (with AbortController so a rapid unmount /
 *   spam-refresh cancels the in-flight request instead of triggering
 *   a "setState on unmounted component" warning).
 * - Refetches when window regains focus (so admin → public realtime feels live).
 * - Refetches on a custom "branding-updated" event broadcast on the same tab
 *   right after the admin saves a new logo.
 */
export function useBranding() {
  const [logo, setLogo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Cancel any previous in-flight request before starting a new one
    // so concurrent calls cannot race each other into setState.
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/branding", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      setLogo(j?.logo ?? null);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      setLogo(null);
    } finally {
      if (inflightRef.current === ctrl) inflightRef.current = null;
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
      inflightRef.current?.abort();
      inflightRef.current = null;
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
