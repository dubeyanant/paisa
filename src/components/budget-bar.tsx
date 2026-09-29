import type { BucketAdherence } from "@/lib/finance/budget";

// The bar's colour follows the bucket's status; the savings bucket is green
// while on track. Class names are written out in full for Tailwind.
const SOLID = { on_track: "bg-accent", at_risk: "bg-warning", over: "bg-negative" };
const LIGHT = { on_track: "bg-accent/35", at_risk: "bg-warning/35", over: "bg-negative/35" };

// A budget bucket against its target: what's been spent (or saved) in solid
// colour, then the planned payments still to come this month in a lighter
// shade of the same colour (owner, 2026-09-29). `elapsed` (0 to 1) marks how
// much of the month has gone.
export function BudgetBar({
  b,
  elapsed,
  size = "md",
}: {
  b: Pick<BucketAdherence, "bucket" | "status" | "actual" | "target" | "plannedLeft">;
  elapsed?: number;
  size?: "sm" | "md";
}) {
  const savingsOk = b.bucket.holds_savings && b.status === "on_track";
  const solid = savingsOk ? "bg-saving" : SOLID[b.status];
  const light = savingsOk ? "bg-saving/35" : LIGHT[b.status];
  const share = (amount: number) => (b.target > 0 ? Math.max(amount, 0) / b.target : amount > 0 ? 1 : 0);
  const done = Math.min(share(b.actual), 1);
  const planned = Math.min(share(b.plannedLeft), 1 - done);
  const height = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className="relative" aria-hidden>
      <div className={`flex ${height} overflow-hidden rounded-full bg-foreground/[0.08]`}>
        <div className={solid} style={{ width: `${done * 100}%` }} />
        <div className={light} style={{ width: `${planned * 100}%` }} />
      </div>
      {elapsed !== undefined && (
        <div
          className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/40"
          style={{ left: `calc(${elapsed * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}
