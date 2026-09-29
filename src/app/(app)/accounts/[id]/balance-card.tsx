"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { Card, buttonClass, inputClass } from "@/components/ui";
import { isOwedType } from "@/lib/accounts";
import type { AccountWithBalance } from "@/lib/data/accounts";
import { cardOutstanding } from "@/lib/finance/balances";
import { formatINR, parseSignedRupees } from "@/lib/finance/money";
import { correctBalance } from "../actions";

// The account's balance now, a way to its entries, and a way to correct the
// balance when it doesn't match the bank's (UAT-22).
export function BalanceCard({ account }: { account: AccountWithBalance }) {
  const owedType = isOwedType(account.type);
  // What the owner sees and types: the amount owed for a card or loan.
  const shown = owedType ? cardOutstanding(account.balance) : account.balance;
  const [correcting, setCorrecting] = useState(false);
  const [actual, setActual] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, startTransition] = useTransition();

  const typed = parseSignedRupees(actual);
  // The correction that will be recorded, as the balance moves.
  const difference = typed === null ? null : (owedType ? 0 - typed : typed) - account.balance;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await correctBalance(account.id, actual);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(`Corrected by ${signed(result.amount)}.`);
        setCorrecting(false);
        setActual("");
      } catch {
        setError("Couldn't reach Paisa. Check your connection and try again.");
      }
    });
  }

  return (
    <Card className="mb-8 max-w-xl p-4 md:p-6">
      <p className="text-sm text-muted">{owedType ? (shown < 0 ? "In credit" : "Owed now") : "Balance now"}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        {formatINR(owedType ? Math.abs(shown) : shown)}
      </p>

      {done && (
        <p role="status" className="mt-2 text-sm text-accent">
          {done}
        </p>
      )}

      {correcting ? (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{owedType ? "Really owed now" : "Real balance now"}</span>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="0"
                className={`${inputClass} pl-7 tabular-nums`}
              />
            </div>
          </label>
          <p className="text-sm text-muted">
            {difference !== null && difference !== 0
              ? `Records a correction of ${signed(difference)} to the balance. `
              : ""}
            A correction changes the balance only. It never counts as spending, income or saving.
          </p>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={pending} className={buttonClass.primary}>
              {pending ? "Correcting…" : "Correct balance"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCorrecting(false);
                setError(undefined);
              }}
              className={buttonClass.secondary}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
          <Link href={`/entries?account=${account.id}`} className={buttonClass.secondary}>
            See entries
            <ChevronRightIcon className="-mr-1 size-5" />
          </Link>
          <button
            type="button"
            onClick={() => {
              setCorrecting(true);
              setDone(undefined);
            }}
            className={buttonClass.secondary}
          >
            Correct balance
          </button>
        </div>
      )}
    </Card>
  );
}

function signed(paise: number) {
  return `${paise < 0 ? "−" : "+"}${formatINR(Math.abs(paise))}`;
}
