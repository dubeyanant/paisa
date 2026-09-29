"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import type { AccountOption, SubcategoryOption } from "@/lib/data/entries";
import type { CommitmentRow } from "@/lib/data/recurring";
import { istDate } from "@/lib/finance/dates";
import { toRupeesInput } from "@/lib/finance/money";
import type { CommitmentInput, Unit } from "@/lib/recurring";
import {
  createCommitment,
  createPlannedOnce,
  deleteCommitment,
  setPaused,
  updateCommitment,
  type RecurringResult,
} from "./actions";

const UNITS: { unit: Unit; one: string; many: string }[] = [
  { unit: "week", one: "week", many: "weeks" },
  { unit: "month", one: "month", many: "months" },
  { unit: "year", one: "year", many: "years" },
];

type Props = {
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
  // Editing an existing commitment...
  commitment?: CommitmentRow;
  // ...or starting a new one, perhaps from a suggestion.
  initial?: Partial<CommitmentInput>;
};

function startingValues(commitment: CommitmentRow | undefined, initial: Partial<CommitmentInput> = {}): CommitmentInput {
  if (commitment) {
    return {
      name: commitment.name,
      kind: commitment.kind,
      amount: toRupeesInput(commitment.amount),
      is_variable: commitment.is_variable,
      account_id: commitment.account_id,
      to_account_id: commitment.to_account_id,
      subcategory_id: commitment.subcategory_id,
      unit: commitment.unit,
      every: commitment.every,
      first_due_on: commitment.first_due_on,
      ends_on: commitment.ends_on ?? "",
    };
  }
  return {
    name: "",
    kind: "expense",
    amount: "",
    is_variable: false,
    account_id: "",
    to_account_id: null,
    subcategory_id: null,
    unit: "month",
    every: 1,
    first_due_on: "",
    ends_on: "",
    ...initial,
  };
}

export function CommitmentForm({ accounts, subcategories, commitment, initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState(() => startingValues(commitment, initial));
  // A new payment can happen once; an existing commitment repeats.
  const [repeats, setRepeats] = useState(Boolean(commitment) || Boolean(initial?.unit));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (changes: Partial<CommitmentInput>) => setValues((v) => ({ ...v, ...changes }));

  // Archived accounts and hidden categories only while already chosen.
  const accountChoices = accounts.filter(
    (a) => !a.archived || a.id === values.account_id || a.id === values.to_account_id,
  );
  const groups = new Map<string, SubcategoryOption[]>();
  for (const s of subcategories) {
    if (s.kind !== "expense" || (s.hidden && s.id !== values.subcategory_id)) continue;
    groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  }

  function run(task: () => Promise<RecurringResult>, after: (id: string) => void) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      let result: RecurringResult;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) after(result.id);
      else setError(result.error);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (commitment) {
      run(() => updateCommitment(commitment.id, values), () => setSaved(true));
    } else {
      run(() => (repeats ? createCommitment(values) : createPlannedOnce(values)), () => router.push("/more/planned"));
    }
  }

  const accountSelect = (value: string | null, onChange: (id: string) => void, label: string) => (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} required className={`${inputClass} px-2`}>
        <option value="">Choose…</option>
        {accountChoices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      {!commitment && (
        <div role="radiogroup" aria-label="How often" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1">
          {([false, true] as const).map((r) => (
            <button
              key={String(r)}
              type="button"
              role="radio"
              aria-checked={repeats === r}
              onClick={() => setRepeats(r)}
              className={`h-10 rounded-lg text-sm font-medium transition-colors ${
                repeats === r ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {r ? "Repeats" : "Once"}
            </button>
          ))}
        </div>
      )}

      <div role="radiogroup" aria-label="Kind of payment" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1">
        {(["expense", "transfer"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={values.kind === k}
            onClick={() => set({ kind: k })}
            className={`h-10 rounded-lg text-sm font-medium transition-colors ${
              values.kind === k ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {k === "expense" ? "Expense" : "Transfer"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <input
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={60}
          required
          autoComplete="off"
          placeholder={values.kind === "expense" ? "Room rent" : "Credit card bill"}
          className={inputClass}
        />
      </label>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{values.is_variable ? "Usual amount" : "Amount"}</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
            <input
              value={values.amount}
              onChange={(e) => set({ amount: e.target.value })}
              inputMode="decimal"
              required
              autoComplete="off"
              placeholder="0"
              className={`${inputClass} pl-7 tabular-nums`}
            />
          </div>
        </label>
        {repeats && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={values.is_variable}
              onChange={(e) => set({ is_variable: e.target.checked })}
              className="mt-0.5 size-5 shrink-0 accent-(--accent)"
            />
            <span>
              <span className="font-medium">The amount changes each time</span>
              <span className="block text-sm text-muted">
                Like electricity. You enter what you paid when you confirm it.
              </span>
            </span>
          </label>
        )}
      </div>

      {values.kind === "expense" ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {accountSelect(values.account_id, (id) => set({ account_id: id }), "Paid from")}
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium">Category</span>
            <select
              value={values.subcategory_id ?? ""}
              onChange={(e) => set({ subcategory_id: e.target.value || null })}
              required
              className={`${inputClass} px-2`}
            >
              <option value="">Choose…</option>
              {[...groups].map(([category, subs]) => (
                <optgroup key={category} label={category}>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {accountSelect(values.account_id, (id) => set({ account_id: id }), "From")}
          {accountSelect(values.to_account_id, (id) => set({ to_account_id: id || null }), "To")}
        </div>
      )}

      {repeats && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Repeats every</legend>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
            <input
              type="number"
              min={1}
              max={52}
              value={values.every}
              onChange={(e) => set({ every: Number(e.target.value) })}
              aria-label="How many"
              required
              className={`${inputClass} tabular-nums`}
            />
            <select
              value={values.unit}
              onChange={(e) => set({ unit: e.target.value as Unit })}
              aria-label="Weeks, months or years"
              className={`${inputClass} px-2`}
            >
              {UNITS.map((u) => (
                <option key={u.unit} value={u.unit}>
                  {values.every === 1 ? u.one : u.many}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">{commitment ? "First due on" : repeats ? "Next due on" : "Due on"}</span>
          <input
            type="date"
            value={values.first_due_on}
            onChange={(e) => set({ first_due_on: e.target.value })}
            required
            className={`${inputClass} px-2`}
          />
        </label>
        {repeats && (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium">
              Ends on <span className="font-normal text-muted">· Optional</span>
            </span>
            <input
              type="date"
              value={values.ends_on}
              onChange={(e) => set({ ends_on: e.target.value })}
              className={`${inputClass} px-2`}
            />
          </label>
        )}
      </div>
      {!commitment && repeats && values.first_due_on && values.first_due_on < istDate(new Date()) && (
        <p className="-mt-2 text-sm font-medium text-negative">
          That&rsquo;s in the past. Every due date from then until today will show as due now, to confirm or skip.
        </p>
      )}
      <p className="-mt-2 text-sm text-muted">
        {commitment
          ? "Due dates count from this date, and payments cover them in order. Change it only if the schedule changes."
          : repeats
            ? "It's due again every time after this. A day like the 31st falls on the last day of shorter months."
            : "The money stays in the account until you confirm it's paid, but it isn't counted as free to spend."}
      </p>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-accent">
          Saved.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Saving…" : commitment ? "Save changes" : "Add planned payment"}
        </button>
        {commitment && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setPaused(commitment.id, !commitment.paused_at), () => router.refresh())}
              className={buttonClass.secondary}
            >
              {commitment.paused_at ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete "${commitment.name}"? Its past payments stay, just no longer linked to it.`)) {
                  run(() => deleteCommitment(commitment.id), () => router.push("/more/planned"));
                }
              }}
              className={buttonClass.danger}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </form>
  );
}
