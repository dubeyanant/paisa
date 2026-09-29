"use client";

import { useActionState, useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { ACCOUNT_TYPES, accountTypeInfo, isOwedType } from "@/lib/accounts";
import { parseSignedRupees, toRupeesInput } from "@/lib/finance/money";
import type { AccountType } from "@/lib/finance/types";
import type { AccountWithBalance } from "@/lib/data/accounts";
import { deleteAccount, saveAccount, setArchived, type AccountFormState } from "./actions";

type Props = {
  account?: AccountWithBalance;
  entryCount?: number;
  today: string;
};

export function AccountForm({ account, entryCount = 0, today }: Props) {
  const [state, action, saving] = useActionState(saveAccount, undefined);
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  // A card or loan asks for the amount owed: the stored balance, flipped.
  const [opening, setOpening] = useState(() => {
    if (!account || account.opening_balance === 0) return "";
    const shown = isOwedType(account.type) ? 0 - account.opening_balance : account.opening_balance;
    return toRupeesInput(shown);
  });

  function changeType(next: AccountType) {
    // Keep the same balance when switching between "balance" and "owed".
    const paise = parseSignedRupees(opening);
    if (paise !== null && paise !== 0 && isOwedType(next) !== isOwedType(type)) {
      setOpening(toRupeesInput(0 - paise));
    }
    setType(next);
  }

  const owed = isOwedType(type);

  return (
    <div className="max-w-xl">
      <form action={action} className="flex flex-col gap-6">
        {account && <input type="hidden" name="id" value={account.id} />}

        <Field label="Name">
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={account?.name}
            placeholder="Main Bank"
            autoComplete="off"
            className={inputClass}
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Kind of account</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ACCOUNT_TYPES.map((t) => (
              <label
                key={t.type}
                className="relative flex min-h-12 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 py-2 text-[15px] leading-tight transition-colors has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium has-checked:text-accent has-focus-visible:ring-2 has-focus-visible:ring-accent/40"
              >
                <input
                  type="radio"
                  name="type"
                  value={t.type}
                  checked={type === t.type}
                  onChange={() => changeType(t.type)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{accountTypeInfo(type).hint}</p>
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label={owed ? "Owed on the opening date" : "Balance on the opening date"}
            note={owed ? "If it was in credit, enter a minus amount." : undefined}
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
                ₹
              </span>
              <input
                name="opening_balance"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                className={`${inputClass} pl-7 tabular-nums`}
              />
            </div>
          </Field>
          <Field label="Opening date">
            <input
              type="date"
              name="opening_date"
              required
              defaultValue={account?.opening_date ?? today}
              className={inputClass}
            />
          </Field>
        </div>

        {type === "credit_card" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Statement day" hint="Optional">
              <DayInput name="statement_day" defaultValue={account?.statement_day} />
            </Field>
            <Field label="Payment due day" hint="Optional">
              <DayInput name="due_day" defaultValue={account?.due_day} />
            </Field>
          </div>
        )}

        {type === "savings" && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="is_emergency_fund"
              defaultChecked={account?.is_emergency_fund}
              className="mt-0.5 size-5 shrink-0 accent-(--accent)"
            />
            <span>
              <span className="font-medium">This is my emergency fund</span>
              <span className="block text-sm text-muted">
                Used to show how many months of spending it covers.
              </span>
            </span>
          </label>
        )}

        {state?.error && (
          <p role="alert" className="text-sm text-negative">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={saving} className={`${buttonClass.primary} sm:w-fit sm:px-8`}>
          {saving ? "Saving…" : account ? "Save changes" : "Add account"}
        </button>
      </form>

      {account && <ManageAccount account={account} entryCount={entryCount} />}
    </div>
  );
}

// Archive, restore or delete, below the form.
function ManageAccount({ account, entryCount }: { account: AccountWithBalance; entryCount: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const archived = Boolean(account.archived_at);

  function run(task: () => Promise<AccountFormState>) {
    setError(undefined);
    startTransition(async () => {
      const result = await task();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="font-medium">{archived ? "Archived" : "Archive"}</h2>
      <p className="mt-1 text-sm text-muted">
        {archived
          ? "This account is hidden when adding entries. Its history stays in every report."
          : "Hide this account when adding entries, for example a closed card. Its history stays in every report."}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setArchived(account.id, !archived))}
          className={buttonClass.secondary}
        >
          {archived ? "Restore account" : "Archive account"}
        </button>
        {entryCount === 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete "${account.name}"? This can't be undone.`)) {
                run(() => deleteAccount(account.id));
              }
            }}
            className={buttonClass.danger}
          >
            Delete account
          </button>
        )}
      </div>
      {entryCount > 0 && (
        <p className="mt-3 text-sm text-muted">
          It has {entryCount.toLocaleString("en-IN")} {entryCount === 1 ? "entry" : "entries"}, so it
          can be archived but not deleted.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  note,
  children,
}: {
  label: string;
  // Short, next to the label.
  hint?: string;
  // Longer, under the field.
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {hint && <span className="font-normal text-muted"> · {hint}</span>}
      </span>
      {children}
      {note && <span className="text-sm text-muted">{note}</span>}
    </label>
  );
}

function DayInput({ name, defaultValue }: { name: string; defaultValue?: number | null }) {
  return (
    <input
      name={name}
      type="number"
      inputMode="numeric"
      min={1}
      max={31}
      placeholder="1–31"
      defaultValue={defaultValue ?? undefined}
      className={`${inputClass} tabular-nums`}
    />
  );
}
