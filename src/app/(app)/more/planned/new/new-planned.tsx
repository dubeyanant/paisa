"use client";

import { useState } from "react";
import type { AccountOption, SubcategoryOption } from "@/lib/data/entries";
import type { CommitmentInput } from "@/lib/recurring";
import { CommitmentForm } from "../commitment-form";
import { FundForm, type FundFormProps } from "../funds/fund-form";

export type PlannedMode = "once" | "repeats" | "fund";

const MODES: { mode: PlannedMode; label: string }[] = [
  { mode: "once", label: "Once" },
  { mode: "repeats", label: "Repeats" },
  { mode: "fund", label: "Save up" },
];

// Something planned: a payment once, one that repeats (TD-18), or money saved
// up over months in a fund (TD-21).
export function NewPlanned({
  start,
  accounts,
  subcategories,
  initial,
  fund,
}: {
  start: PlannedMode;
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
  initial: Partial<CommitmentInput>;
  fund: Pick<FundFormProps, "buckets" | "months">;
}) {
  const [mode, setMode] = useState(start);
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div role="radiogroup" aria-label="What to plan" className="grid grid-cols-3 gap-1 rounded-xl bg-foreground/[0.06] p-1">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            onClick={() => setMode(m.mode)}
            className={`h-10 rounded-lg text-sm font-medium transition-colors ${
              mode === m.mode ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "fund" ? (
        <FundForm {...fund} />
      ) : (
        <CommitmentForm accounts={accounts} subcategories={subcategories} initial={initial} repeats={mode === "repeats"} />
      )}
    </div>
  );
}
