"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Rolling buffer of recent numeric samples — used by the CPU/RAM
 * sparkline tiles on the public server card.
 *
 * The dashboard polls `/api/servers/public` every ~10 s. Each poll
 * delivers ONE fresh CPU% / RAM% number per server. We keep the last
 * `size` samples in component state so a tiny inline chart can show
 * the recent trend without any new API call or DB query — the data is
 * 100% real (it's the same value the server card is already
 * displaying), just retained across polls.
 *
 * Why client-side and not server-side:
 *
 *  - The `/api/servers/[id]/metrics` endpoint already exposes a longer
 *    history but is keyed per-server, which is overkill for the
 *    homepage's compact card sparklines.
 *  - State persists across re-renders because each `<ServerCard>` is
 *    keyed by `server.id` in the parent's `.map()`, so React keeps the
 *    instance alive and the buffer with it.
 *  - On unmount (server removed / filter excludes it) the buffer is
 *    discarded — exactly the right behavior for a UI cache.
 *
 * Usage:
 *
 *   const cpuHistory = useMetricBuffer(server.cpuPercent, 30);
 *   //                                  ^ value          ^ keep last 30
 *
 * Returns an array of `{ value: number; index: number }` so consumers
 * can feed it directly into recharts without massaging the shape.
 */
export type SparkPoint = { value: number; index: number };

export function useMetricBuffer(
  value: number | null | undefined,
  size = 30,
): SparkPoint[] {
  const [buffer, setBuffer] = useState<SparkPoint[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (value == null || !isFinite(value)) return;
    setBuffer((prev) => {
      const next = prev.concat({ value, index: counterRef.current++ });
      // Trim from the head so the oldest sample falls off the chart
      // — the visual effect is a smooth left-to-right scroll as new
      // polls come in.
      if (next.length > size) return next.slice(next.length - size);
      return next;
    });
  }, [value, size]);

  return buffer;
}
