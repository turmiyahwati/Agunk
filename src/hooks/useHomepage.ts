"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_HOMEPAGE, type HomepageContent } from "@/lib/homepage";

const HOMEPAGE_EVENT = "agunk:homepage-updated";

/**
 * Fetches the editable homepage content from /api/homepage.
 *
 * - State is initialized with DEFAULT_HOMEPAGE so server-rendered markup
 *   and the first client paint match exactly (no hydration mismatch).
 * - Refetches on mount (cancellable via AbortController), on window
 *   focus, and on the same-tab custom event after admin save.
 */
export function useHomepage() {
  const [content, setContent] = useState<HomepageContent>(DEFAULT_HOMEPAGE);
  const [loaded, setLoaded] = useState(false);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const res = await fetch("/api/homepage", {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (ctrl.signal.aborted) return;
      if (j?.content) {
        setContent({ ...DEFAULT_HOMEPAGE, ...j.content });
      }
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
    window.addEventListener(HOMEPAGE_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(HOMEPAGE_EVENT, onCustom);
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, [refresh]);

  return { content, loaded, refresh };
}

/** Admin pages call this after a successful save to update other tabs. */
export function broadcastHomepageUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HOMEPAGE_EVENT));
  }
}
