"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import type { FundRow } from "@/lib/data/funds";
import { formatINR, parseRupees, toRupeesInput } from "@/lib/finance/money";
import { goalPreview, type FundInput } from "@/lib/funds";
import { createFund, updateFund, type FundResult } from "./actions";

export type FundFormProps = {
  // The active rule's buckets, for where money going in counts.
  buckets: { id: string; name: string; holds_savings: boolean }[];
  // The budget months a goal can use, this one first.
  months: { value: string; label: string }[];
  // Editing an existing fund. A target fund had put in `before` just before
  // this month's share (all of it, if it hasn't started), and `extra` came in
  // after it...
  fund?: FundRow;
  before?: number;
  extra?: number;
  // ...whose schedule has started, so a goal keeps its first month.
  started?: boolean;
  // ...or starting a new one.
  kind?: FundRow["kind"];
};

// The bucket a new fund counts in: Wants if there is one, else the first
// that isn't for savings.
function usualBucket(buckets: FundFormProps["buckets"]) {
  return (buckets.find((b) => /want/i.test(b.name)) ?? buckets.find((b) => !b.holds_savings))?.id ?? null;
}

function startingValues({ fund, buckets, months, kind }: FundFormProps): FundInput {
  const optional = (paise: number | null) => (paise === null ? "" : toRupeesInput(paise));
  if (fund) {
    return {
      name: fund.name,
      kind: fund.kind,
      bucket_id: fund.bucket_id,
      target: optional(fund.target),
      monthly_amount: optional(fund.monthly_amount),
      cap: optional(fund.cap),
      from_month: fund.schedule_from,
      to_month: fund.ends_on ?? "",
      closes_when_spent: fund.closes_when_spent,
      put_in: "",
    };
  }
  return {
    name: "",
    kind: kind ?? "goal",
    bucket_id: usualBucket(buckets),
    target: "",
    monthly_amount: "",
    cap: "",
    from_month: months[0]?.value ?? "",
    // Four months, a common stretch to save up over.
    to_month: months[3]?.value ?? "",
    closes_when_spent: true,
    put_in: "",
  };
}

// "₹15,000 a month for 4 months." or "₹15,000 this month, then ₹13,334 a month."
function previewText({ first, then }: { first: number; then: number | null }, months: number, now: boolean) {
  if (first === 0 && !then) return "Already saved up.";
  if (then === null) return `${formatINR(first)} in one month.`;
  if (then === first) return `${formatINR(first)} a month for ${months} months.`;
  return `${formatINR(first)} ${now ? "this month" : "the first month"}, then ${formatINR(then)} a month.`;
}

export function FundForm(props: FundFormProps) {
  const { fund, buckets, months, before = 0, extra = 0, started = false } = props;
  const router = useRouter();
  const [values, setValues] = useState(() => startingValues(props));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (changes: Partial<FundInput>) => {
    setValues((v) => ({ ...v, ...changes }));
    setSaved(false);
  };
  const goal = values.kind === "goal";

  // A goal already saving keeps its first month; its last month can't be past.
  const fromChoices = months;
  const toChoices = months.filter((m) => m.value >= (started ? months[0].value : values.from_month));
  const withCurrent = (choices: typeof months, value: string) =>
    value && !choices.some((c) => c.value === value) ? [{ value, label: "As before" }, ...choices] : choices;

  // What goes in each month, worked out as the schedule does. A goal already
  // saving recalculates this month's share from what it held before it.
  const target = parseRupees(values.target) ?? 0;
  const firstMonth = started ? months[0]?.value : values.from_month;
  const monthsLeft = months.findIndex((m) => m.value === values.to_month) - months.findIndex((m) => m.value === firstMonth) + 1;
  const now = started || firstMonth === months[0]?.value;
  const putIn = fund ? 0 : (parseRupees(values.put_in) ?? 0);
  const preview = fund
    ? goalPreview(target, before, extra, monthsLeft)
    : goalPreview(target, now ? 0 : putIn, now ? putIn : 0, monthsLeft);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      let result: FundResult;
      try {
        result = await (fund ? updateFund(fund.id, values) : createFund(values));
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (!result.ok) setError(result.error);
      else if (fund) setSaved(true);
      else router.push(`/more/planned/funds/${result.id}`);
    });
  }

  const rupees = (label: string, value: string, onChange: (v: string) => void, hint?: string, required = false) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {!required && <span className="font-normal text-muted"> · Optional</span>}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          required={required}
          autoComplete="off"
          placeholder="0"
          className={`${inputClass} pl-7 tabular-nums`}
        />
      </div>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );

  const monthSelect = (label: string, value: string, choices: typeof months, onChange: (v: string) => void) => (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required className={`${inputClass} px-2`}>
        {withCurrent(choices, value).map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      {!fund && (
        <div>
          <div role="radiogroup" aria-label="Kind of fund" className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1">
            {(["goal", "ongoing"] as const).map((k) => (
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
                {k === "goal" ? "Target" : "Recurring"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            {goal
              ? "Save a set amount over a few months for something you'll buy, like a guitar."
              : "Fill up to a limit each month for spending that comes and goes, like clothes. It fills back up after you spend."}
          </p>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <input
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={60}
          required
          autoComplete="off"
          placeholder={goal ? "New phone" : "Clothes"}
          className={inputClass}
        />
      </label>

      {goal ? (
        <>
          {rupees("How much", values.target, (target) => set({ target }), undefined, true)}
          <div className="grid grid-cols-2 gap-3">
            {started ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">From</span>
                <p className="flex h-12 items-center text-muted">Already saving</p>
              </div>
            ) : (
              monthSelect("From", values.from_month, fromChoices, (from_month) =>
                set({ from_month, to_month: values.to_month < from_month ? from_month : values.to_month }),
              )
            )}
            {monthSelect("Until", values.to_month, toChoices, (to_month) => set({ to_month }))}
          </div>
          {target > 0 && monthsLeft > 0 && (
            <p className="-mt-2 text-sm text-muted tabular-nums">
              {previewText(preview, monthsLeft, now)}
              {preview.first + (preview.then ?? 0) > 0 && " It's kept out of available to spend, and the money stays in your bank."}
            </p>
          )}
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={values.closes_when_spent}
              onChange={(e) => set({ closes_when_spent: e.target.checked })}
              className="mt-0.5 size-5 shrink-0 accent-(--accent)"
            />
            <span>
              <span className="font-medium">Close it when I buy it</span>
              <span className="block text-sm text-muted">
                What&rsquo;s left becomes free to spend again. Turn off to spend from it bit by bit, like on a trip.
              </span>
            </span>
          </label>
        </>
      ) : (
        <>
          {rupees(
            "Each month",
            values.monthly_amount,
            (monthly_amount) => set({ monthly_amount }),
            "Goes in on the first day of each budget month.",
          )}
          {rupees("Up to", values.cap, (cap) => set({ cap }), "It stops filling here, and fills back up after you spend from it.")}
        </>
      )}

      {buckets.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Budget bucket</span>
          <select
            value={values.bucket_id ?? ""}
            onChange={(e) => set({ bucket_id: e.target.value || null })}
            className={`${inputClass} px-2`}
          >
            <option value="">No bucket</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted">
            Money counts here as it goes in, so spending it later doesn&rsquo;t hit that month again.
          </span>
        </label>
      )}

      {!fund && rupees("Put in now", values.put_in, (put_in) => set({ put_in }), "Money you've already saved for it.")}

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

      <button type="submit" disabled={pending} className={`${buttonClass.primary} h-12 sm:w-fit sm:px-10`}>
        {pending ? "Saving…" : fund ? "Save changes" : "Start fund"}
      </button>
    </form>
  );
}
