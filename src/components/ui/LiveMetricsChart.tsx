"use client";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

/**
 * Live Metrics history chart for the public server detail page.
 *
 * Three lines on two y-axes:
 *  • CPU %  (cyan)    — yAxisId="pct" 0-100
 *  • RAM %  (purple)  — yAxisId="pct" 0-100
 *  • Users  (emerald) — yAxisId="users" auto, plots `activeLogins`
 *    (currently-connected sessions, not subscriber totals).
 *
 * Lives in its own module so the detail page can lazy-load it via
 * `next/dynamic({ ssr: false })` and keep Recharts (~50 KB gzipped)
 * out of the route's initial JS bundle. While the chunk loads the
 * caller renders an `h-56` placeholder so the surrounding layout does
 * not jump when the chart paints in.
 */
export type LiveMetricPoint = {
  ts: string;
  activeUsers: number;
  activeLogins: number;
  cpuPercent: number;
  ramPercent: number;
};

export function LiveMetricsChart({ data }: { data: LiveMetricPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="ts" hide />
        {/*
          Two y-axes so CPU/RAM (0-100%) and active users
          (0..maxSlot) don't squash each other on the same
          scale. activeLogins gets its own axis on the right.
        */}
        <YAxis yAxisId="pct" hide domain={[0, 100]} />
        <YAxis yAxisId="users" orientation="right" hide />
        <Tooltip
          contentStyle={{
            background: "rgba(15,23,42,0.9)",
            border: "1px solid rgba(34,211,238,0.3)",
            borderRadius: 12,
            color: "#e2e8f0",
          }}
          labelFormatter={(v) => new Date(v).toLocaleTimeString("id-ID")}
        />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="cpuPercent"
          stroke="#22d3ee"
          strokeWidth={2}
          dot={false}
          name="CPU %"
          isAnimationActive={true}
          animationDuration={800}
        />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="ramPercent"
          stroke="#a855f7"
          strokeWidth={2}
          dot={false}
          name="RAM %"
          isAnimationActive={true}
          animationDuration={800}
        />
        <Line
          yAxisId="users"
          type="monotone"
          dataKey="activeLogins"
          stroke="#10b981"
          strokeWidth={1.5}
          dot={false}
          name="User Aktif"
          isAnimationActive={true}
          animationDuration={800}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default LiveMetricsChart;
