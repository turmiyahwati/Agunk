"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PROTOCOLS, type ProtocolItem } from "@/lib/protocols";

const PROTOCOLS_EVENT = "agunk:protocols-updated";

/**
 * Fetches the editable Protocol Information list from /api/protocols.
 *
 * - State is initialized with DEFAULT_PROTOCOLS so SSR markup matches the
 *   first client paint (no hydration mismatch).
 * - Refetches on mount (cancellable via AbortController), on window
 *   focus, and on the same-tab custom event after admin save.
 */
export function useProtocols() {
  const [items, setItems] = useState<ProtocolItem[]>(DEFAULT_PROTOCOLS);
  const [loaded, setLoaded] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/protocols", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      if (Array.isArray(j?.protocols)) setItems(j.protocols);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      // Silent fail — defaults remain.
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
    window.addEventListener(PROTOCOLS_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PROTOCOLS_EVENT, onCustom);
      inflightRef.current?.abort();
      inflightRef.current = null;
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
