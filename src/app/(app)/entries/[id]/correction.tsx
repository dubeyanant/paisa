"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useGoBack } from "@/components/back";
import { Card, buttonClass } from "@/components/ui";
import type { AccountOption, Entry } from "@/lib/data/entries";
import { istDayLabel, istTime } from "@/lib/describe-entry";
import { formatINR } from "@/lib/finance/money";
import { deleteEntries } from "../../add/actions";

// A balance correction can't be edited, only deleted: to change one, delete it
// and correct the balance again from the account (BR-13).
export function Correction({ entry, account }: { entry: Entry; account: AccountOption | undefined }) {
  const goBack = useGoBack("/entries");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!confirm("Delete this balance correction? The account's balance changes back.")) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await deleteEntries([entry.id]);
        if (result.ok) goBack();
        else setError(result.error);
      } catch {
        setError("Couldn't reach Paisa. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card className="p-4 md:p-6">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {entry.amount < 0 ? "−" : "+"}
          {formatINR(Math.abs(entry.amount))}
        </p>
        <p className="mt-1 text-muted">
          {account?.name ?? "Unknown account"} · {istDayLabel(entry.occurred_at)}, {istTime(entry.occurred_at)}
        </p>
        {entry.note && <p className="mt-3">{entry.note}</p>}
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
          A correction changes the account&apos;s balance only. It never counts as spending, income or saving.
          To change it, delete it and correct the balance again from the account.
        </p>
      </Card>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {account && (
          <Link href={`/accounts/${account.id}`} className={buttonClass.secondary}>
            Open {account.name}
          </Link>
        )}
        <button type="button" onClick={remove} disabled={pending} className={buttonClass.danger}>
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
