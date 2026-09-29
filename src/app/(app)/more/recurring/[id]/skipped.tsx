"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { unskipDue, type RecurringResult } from "../actions";

// Due dates the owner skipped. Undoing one makes it due again.
export function Skipped({ commitmentId, dates }: { commitmentId: string; dates: { date: string; label: string }[] }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function undo(date: string) {
    setError(undefined);
    startTransition(async () => {
      let result: RecurringResult;
      try {
        result = await unskipDue(commitmentId, date);
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <Card>
        <ul className="divide-y divide-line">
          {dates.map(({ date, label }) => (
            <li key={date} className="flex min-h-12 items-center gap-3 py-1 pr-2 pl-4">
              <p className="min-w-0 flex-1">{label}</p>
              <button
                type="button"
                disabled={pending}
                onClick={() => undo(date)}
                className="h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-60"
              >
                Undo skip
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {error && (
        <p role="alert" className="mt-2 text-sm text-negative">
          {error}
        </p>
      )}
    </>
  );
}
