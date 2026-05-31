"use client";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { SparkPoint } from "@/hooks/useMetricBuffer";

/**
 * Compact sparkline area chart for the CPU / RAM tiles on the public
 * server cards.
 *
 * Lives in its own module so the homepage can lazy-load it via
 * `next/dynamic({ ssr: false })` and keep Recharts (~50 KB gzipped)
 * out of the initial JS bundle. The card renders an empty placeholder
 * (`h-8`) until enough samples accumulate to make a curve worth
 * looking at, so users on slow mobile connections see the card content
 * paint immediately and the sparkline fills in once Recharts is ready.
 */
export function MiniSparkline({
  data,
  color,
  fillId,
}: {
  data: SparkPoint[];
  color: string;
  fillId: string;
}) {
  if (data.length < 2) return <div className="h-8" />;
  return (
    <div className="h-8 -mx-1 -mb-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default MiniSparkline;
