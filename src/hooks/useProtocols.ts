"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PROTOCOLS, type ProtocolItem } from "@/lib/protocols";

const PROTOCOLS_EVENT = "agunk:protocols-updated";

/**
 * Fetches the editable Protocol Information list from /api/protocols.
 *
 * - State is initialized with DEFAULT_PROTOCOLS so SSR markup matches the
 *   first client paint (no hydration mismatch).
 * - Refetches on mount, on window focus, and on the same-tab custom
 *   event dispatched by the admin page after a successful save.
 */
export function useProtocols() {
  const [items, setItems] = useState<ProtocolItem[]>(DEFAULT_PROTOCOLS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/protocols", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.protocols)) setItems(j.protocols);
    } catch {
      // Silent fail — defaults remain.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onCustom = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(PROTOCOLS_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PROTOCOLS_EVENT, onCustom);
    };
  }, [refresh]);

  return { items, loaded, refresh };
}

/** Admin page calls this after a successful save to refresh other tabs. */
export function broadcastProtocolsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROTOCOLS_EVENT));
  }
}
