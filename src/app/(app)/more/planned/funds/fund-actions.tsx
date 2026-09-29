"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, buttonClass, inputClass } from "@/components/ui";
import { formatINR } from "@/lib/finance/money";
import { closeFund, deleteFund, moveMoney, type FundResult } from "./actions";

// Adding money to a fund or taking it back out (TD-21).
export function MoveMoney({ fundId, balance }: { fundId: string; balance: number }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  // Made here, so pressing again after a lost answer can't move the money twice.
  const [moveId, setMoveId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setDone(undefined);
    startTransition(async () => {
      let result: FundResult;
      try {
        result = await moveMoney(moveId, fundId, direction, amount);
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(direction === "in" ? "Added." : "Taken out. It's free to spend again.");
      setAmount("");
      setMoveId(crypto.randomUUID());
      router.refresh();
    });
  }

  return (
    <Card className="p-4 md:p-6">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Add or take out" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1">
          {(["in", "out"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={`h-10 rounded-lg text-sm font-medium transition-colors ${
                direction === d ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {d === "in" ? "Add money" : "Take out"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              required
              autoComplete="off"
              placeholder="0"
              aria-label="Amount in rupees"
              className={`${inputClass} pl-7 tabular-nums`}
            />
          </div>
          <button type="submit" disabled={pending} className={`${buttonClass.primary} h-12 shrink-0`}>
            {pending ? "Saving…" : direction === "in" ? "Add" : "Take out"}
          </button>
        </div>
        <p className="text-sm text-muted">
          {direction === "in"
            ? "A lump sum, like part of a bonus. It counts in the fund's budget bucket this month."
            : `Back to free to spend, up to the ${formatINR(balance)} it holds.`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-accent">
            {done}
          </p>
        )}
      </form>
    </Card>
  );
}

// Closing frees what a fund holds; deleting is only for a fund that paid for nothing.
export function CloseOrDelete({ fundId, balance, open, canDelete }: { fundId: string; balance: number; open: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<FundResult>, after: () => void) {
    setError(undefined);
    startTransition(async () => {
      let result: FundResult;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) after();
      else setError(result.error);
    });
  }

  function close() {
    const freed = balance > 0 ? ` The ${formatINR(balance)} it holds becomes free to spend again.` : "";
    if (!confirm(`Close this fund?${freed}`)) return;
    run(() => closeFund(fundId), () => router.refresh());
  }

  function remove() {
    if (!confirm("Delete this fund? Its history goes too. This can't be undone.")) return;
    run(() => deleteFund(fundId), () => router.push("/more/planned"));
  }

  if (!open && !canDelete) return null;
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <div className="flex flex-wrap gap-3">
        {open && (
          <button type="button" onClick={close} disabled={pending} className={buttonClass.secondary}>
            Close fund
          </button>
        )}
        {canDelete && (
          <button type="button" onClick={remove} disabled={pending} className={buttonClass.danger}>
            Delete
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
