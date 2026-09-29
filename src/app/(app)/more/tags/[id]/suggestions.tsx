"use client";

import { useState, useTransition } from "react";
import { Card, buttonClass } from "@/components/ui";
import type { AccountOption, Entry, SubcategoryOption } from "@/lib/data/entries";
import { describeEntry, istDayLabel } from "@/lib/describe-entry";
import { formatINR } from "@/lib/finance/money";
import { tagEntries } from "../actions";

// Entries the owner may tag. None is chosen until they choose (FR-5).
export function Suggestions({
  tagId,
  entries,
  accounts,
  subcategories,
}: {
  tagId: string;
  entries: Entry[];
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(undefined);
    const ids = [...chosen];
    startTransition(async () => {
      try {
        const result = await tagEntries(tagId, ids);
        if (result.ok) setChosen(new Set());
        else setError(result.error);
      } catch {
        setError("Couldn't reach Paisa. Check your connection and try again.");
      }
    });
  }

  const all = chosen.size === entries.length;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <ul className="divide-y divide-line">
          {entries.map((entry) => {
            const d = describeEntry(entry, accountById, subById);
            return (
              <li key={entry.id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]">
                  <input
                    type="checkbox"
                    checked={chosen.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                    className="size-5 shrink-0 accent-(--accent)"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    <span className="block truncate text-sm text-muted">
                      {istDayLabel(entry.occurred_at)} · {d.detail}
                    </span>
                  </span>
                  <span className={`shrink-0 font-medium tabular-nums ${d.direction === "in" ? "text-accent" : ""}`}>
                    {d.direction === "in" ? "+" : d.direction === "out" ? "−" : ""}
                    {formatINR(Math.abs(d.amount))}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] flex flex-wrap gap-3 md:bottom-6">
        <button
          type="button"
          onClick={submit}
          disabled={pending || chosen.size === 0}
          className={`${buttonClass.primary} shadow-lg`}
        >
          {pending ? "Tagging…" : chosen.size > 0 ? `Tag ${chosen.size} ${chosen.size === 1 ? "entry" : "entries"}` : "Tag entries"}
        </button>
        <button
          type="button"
          onClick={() => setChosen(all ? new Set() : new Set(entries.map((e) => e.id)))}
          className={`${buttonClass.secondary} shadow-lg`}
        >
          {all ? "Choose none" : "Choose all"}
        </button>
      </div>
    </div>
  );
}
