"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, buttonClass, inputClass } from "@/components/ui";
import { formatINR, toRupeesInput } from "@/lib/finance/money";
import { confirmDue, confirmPlanned, skipDue, unskipDue, type RecurringResult } from "./actions";

// What's due now, ready for the browser: names and labels worked out on the
// server.
export type DueRow =
  | {
      type: "due";
      commitmentId: string;
      title: string;
      detail: string;
      due_on: string;
      // "today", "5 Sep": see dayInSentence().
      day: string;
      overdue: boolean;
      // Further unpaid due dates up to today.
      more: number;
      amount: number;
      variable: boolean;
    }
  | { type: "planned"; entryId: string; title: string; detail: string; day: string; amount: number };

type Status = { text: string; link?: { href: string; label: string }; undo?: () => Promise<RecurringResult> };

// Pending entries (FR-6): confirm each with one tap, changing the amount first
// if the bill came to something else, or skip it.
export function DueNow({ rows }: { rows: DueRow[] }) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<RecurringResult>, done?: Status) {
    setError(undefined);
    setStatus(undefined);
    startTransition(async () => {
      let result: RecurringResult;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) setStatus(done);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {status && (
        <div role="status" className="flex min-h-11 items-center gap-3 rounded-xl bg-accent-soft py-1 pr-1 pl-4 text-accent">
          <p className="min-w-0 flex-1 text-sm">{status.text}</p>
          {status.link && (
            <Link href={status.link.href} className="flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium hover:bg-accent/10">
              {status.link.label}
            </Link>
          )}
          {status.undo && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(status.undo!)}
              className="h-9 shrink-0 rounded-lg px-3 text-sm font-medium hover:bg-accent/10"
            >
              Undo
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.type === "due" ? `${row.commitmentId}|${row.due_on}` : row.entryId} className="p-4">
                {row.type === "due" ? (
                  <DueItem row={row} pending={pending} run={run} />
                ) : (
                  <PlannedItem row={row} pending={pending} run={run} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type RunProps = { pending: boolean; run: (task: () => Promise<RecurringResult>, done?: Status) => void };

function DueItem({ row, pending, run }: { row: Extract<DueRow, { type: "due" }> } & RunProps) {
  const [amount, setAmount] = useState(toRupeesInput(row.amount));
  // Made once per due date, so pressing Confirm twice can't pay twice.
  const [paymentId] = useState(() => crypto.randomUUID());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{row.title}</p>
          <p className="text-sm text-muted">
            <span className={row.overdue ? "font-medium text-negative" : undefined}>Due {row.day}</span>
            {row.more > 0 && ` · ${row.more} more due after it`}
            {" · "}
            {row.detail}
          </p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(() => confirmDue(paymentId, row.commitmentId, row.due_on, amount), {
            text: `${row.title}: paid.`,
            link: { href: `/entries/${paymentId}`, label: "View" },
          });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-0 flex-1 basis-32">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            aria-label={`Amount paid for ${row.title}`}
            autoComplete="off"
            className={`${inputClass} h-11 pl-7 tabular-nums`}
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          Confirm
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => skipDue(row.commitmentId, row.due_on), {
              text: `${row.title}: skipped for ${row.day}.`,
              undo: () => unskipDue(row.commitmentId, row.due_on),
            })
          }
          className={buttonClass.secondary}
        >
          Skip
        </button>
      </form>
      {row.variable && <p className="-mt-1 text-sm text-muted">The amount varies. Enter what you actually paid.</p>}
    </div>
  );
}

function PlannedItem({ row, pending, run }: { row: Extract<DueRow, { type: "planned" }> } & RunProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate font-medium">{row.title}</p>
        <p className="text-sm text-muted">
          Planned for {row.day} · {row.detail}
        </p>
      </div>
      <p className="shrink-0 font-medium tabular-nums">{formatINR(row.amount)}</p>
      <div className="flex w-full gap-2 sm:w-auto">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => confirmPlanned(row.entryId), { text: `${row.title}: confirmed.` })}
          className={`${buttonClass.primary} flex-1 sm:flex-none`}
        >
          It happened
        </button>
        <Link href={`/entries/${row.entryId}`} className={`${buttonClass.secondary} flex-1 sm:flex-none`}>
          Edit
        </Link>
      </div>
    </div>
  );
}
