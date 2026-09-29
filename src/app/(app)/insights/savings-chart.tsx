"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/finance/money";

// label is short, for the axis; full names the budget month in the tooltip.
// saved is paise: income minus spending, negative when more went out.
export type SavingsPoint = { label: string; full: string; saved: number };

// ₹18,000 → "₹18k", ₹1,20,000 → "₹1.2L", for the axis only.
function compact(rupees: number): string {
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 100000) return `${sign}₹${Number((abs / 100000).toFixed(1))}L`;
  if (abs >= 1000) return `${sign}₹${Math.round(abs / 1000)}k`;
  return `${sign}₹${abs}`;
}

// INS-02: what was saved in each finished month, in rupees (TD-17). Rupees, not
// the rate: a month with little income recorded makes a rate like -7,500%.
// Colours come from the theme, so the chart follows light and dark mode; the
// list under it gives every figure.
export function SavingsChart({ points }: { points: SavingsPoint[] }) {
  const data = points.map((p) => ({ ...p, value: p.saved / 100 }));
  return (
    <div className="h-48" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={compact}
            width={52}
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
                    {p.saved >= 0 ? `Saved ${formatINR(p.saved)}` : `${formatINR(-p.saved)} more spent than earned`}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            {data.map((p) => (
              <Cell key={p.full} fill={p.saved < 0 ? "var(--negative)" : "var(--accent)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
