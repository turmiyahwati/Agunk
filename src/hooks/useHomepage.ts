"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_HOMEPAGE, type HomepageContent } from "@/lib/homepage";

const HOMEPAGE_EVENT = "agunk:homepage-updated";

/**
 * Fetches the editable homepage content from /api/homepage.
 *
 * - State is initialized with DEFAULT_HOMEPAGE so server-rendered markup
 *   and the first client paint match exactly (no hydration mismatch).
 * - Refetches on mount, on window focus, and when the same-tab custom
 *   event is dispatched after an admin save.
 */
export function useHomepage() {
  const [content, setContent] = useState<HomepageContent>(DEFAULT_HOMEPAGE);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/homepage", { cache: "no-store" });
      const j = await res.json();
      if (j?.content) {
        setContent({ ...DEFAULT_HOMEPAGE, ...j.content });
      }
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
    window.addEventListener(HOMEPAGE_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(HOMEPAGE_EVENT, onCustom);
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
