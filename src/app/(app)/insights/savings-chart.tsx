"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/finance/money";

// label is short, for the axis; full names the budget month in the tooltip.
export type SavingsPoint = { label: string; full: string; rate: number | null; saved: number };

// INS-02: the savings rate month by month (TD-17). Colours come from the theme,
// so the chart follows light and dark mode. The headline and a table for
// screen readers render with it.
export function SavingsChart({ points }: { points: SavingsPoint[] }) {
  const data = points.map((p) => ({ ...p, value: p.rate === null ? 0 : Math.round(p.rate * 100) }));
  return (
    <div className="h-48" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(v: number) => `${v}%`}
            width={44}
            allowDecimals={false}
          />
          <ReferenceLine y={0} stroke="var(--muted)" />
          <Tooltip
            cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as SavingsPoint | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm">
                  <p className="font-medium">{p.full}</p>
                  <p className="text-muted tabular-nums">
                    {p.rate === null ? "No income" : `${Math.round(p.rate * 100)}% · ${formatINR(p.saved)}`}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
