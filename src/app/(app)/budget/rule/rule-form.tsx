"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { Card, buttonClass, inputClass } from "@/components/ui";
import { PRESETS, applyPreset, formatShare, parseShare, ruleName, type RuleBucketInput, type RuleInput } from "@/lib/budget";
import { saveRule, type RuleResult } from "../actions";

type Props = {
  ruleId: string;
  initial: RuleInput;
  // How many subcategories each existing bucket holds, to say what moves.
  counts: Record<string, number>;
};

// Edits the active budget rule (FR-7): a preset or custom buckets, and what
// the rule divides up.
export function RuleForm({ ruleId, initial, counts }: Props) {
  const router = useRouter();
  const [rule, setRule] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const set = (changes: Partial<RuleInput>) => setRule((r) => ({ ...r, ...changes }));
  const setBucket = (key: string, changes: Partial<RuleBucketInput>) =>
    set({ buckets: rule.buckets.map((b) => (b.key === key ? { ...b, ...changes } : b)) });

  const total = rule.buckets.reduce((sum, b) => sum + (parseShare(b.share) ?? 0), 0);
  // Existing buckets that are gone, and where their subcategories go.
  const removed = initial.buckets.filter((b) => b.id && !rule.buckets.some((x) => x.id === b.id));
  const moveTarget = (id: string) => rule.moves[id] ?? rule.buckets.find((b) => !b.holds_savings)?.key ?? rule.buckets[0]?.key;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    const moves = Object.fromEntries(removed.map((b) => [b.id!, moveTarget(b.id!)]).filter(([, to]) => to));
    startTransition(async () => {
      let result: RuleResult;
      try {
        result = await saveRule(ruleId, { ...rule, name: ruleName(rule.name, rule.buckets), moves });
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      if (result.ok) router.push("/budget");
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">Start from a preset</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() =>
                set({ buckets: applyPreset(rule.buckets, p.shares), name: ruleName(rule.name, p.shares.map(String).map((share) => ({ share }))) })
              }
              className="h-11 rounded-xl border border-line bg-surface px-4 font-medium tabular-nums transition-colors hover:border-accent"
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">Needs, Wants and Savings. Or change the buckets below.</p>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Buckets</h2>
          <p className={`text-sm font-medium tabular-nums ${total === 10000 ? "text-muted" : "text-negative"}`}>
            {total === 10000 ? "Adds up to 100%" : `${formatShare(total)} of 100%`}
          </p>
        </div>
        <Card>
          <ul className="divide-y divide-line">
            {rule.buckets.map((b) => (
              <li key={b.key} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={b.name}
                    onChange={(e) => setBucket(b.key, { name: e.target.value })}
                    maxLength={40}
                    required
                    aria-label="Bucket name"
                    placeholder="Name"
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <div className="relative w-24 shrink-0">
                    <input
                      value={b.share}
                      onChange={(e) => setBucket(b.key, { share: e.target.value })}
                      inputMode="decimal"
                      required
                      aria-label={`${b.name || "Bucket"} share in percent`}
                      className={`${inputClass} pr-7 text-right tabular-nums`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">%</span>
                  </div>
                  <button
                    type="button"
                    disabled={rule.buckets.length <= 2}
                    onClick={() => set({ buckets: rule.buckets.filter((x) => x.key !== b.key) })}
                    aria-label={`Remove ${b.name || "bucket"}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
                  >
                    <CloseIcon className="size-5" />
                  </button>
                </div>
                <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="savings"
                    checked={b.holds_savings}
                    onChange={() => set({ buckets: rule.buckets.map((x) => ({ ...x, holds_savings: x.key === b.key })) })}
                    className="size-4 accent-(--accent)"
                  />
                  Money moved into savings counts here
                </label>
              </li>
            ))}
          </ul>
        </Card>
        {rule.buckets.length < 6 && (
          <button
            type="button"
            onClick={() =>
              set({
                buckets: [...rule.buckets, { key: crypto.randomUUID(), id: null, name: "", share: "0", holds_savings: false }],
              })
            }
            className={`${buttonClass.secondary} mt-3 w-fit`}
          >
            <PlusIcon className="size-5" />
            Add a bucket
          </button>
        )}
        <p className="mt-2 text-sm text-muted">2 to 6 buckets. Choose each category&rsquo;s bucket under More → Categories.</p>
      </section>

      {removed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Removed buckets</h2>
          {removed.map((b) => (
            <label key={b.id} className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">
                {b.name}&rsquo;s {counts[b.id!] ?? 0} {counts[b.id!] === 1 ? "category moves" : "categories move"} to
              </span>
              <select
                value={moveTarget(b.id!)}
                onChange={(e) => set({ moves: { ...rule.moves, [b.id!]: e.target.value } })}
                className={`${inputClass} px-2`}
              >
                {rule.buckets.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name || "New bucket"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What it divides up</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1" role="radiogroup" aria-label="Base">
          {(["income", "fixed"] as const).map((base) => (
            <button
              key={base}
              type="button"
              role="radio"
              aria-checked={rule.base === base}
              onClick={() => set({ base })}
              className={`h-10 rounded-lg text-sm font-medium transition-colors ${
                rule.base === base ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {base === "income" ? "Income each month" : "A fixed amount"}
            </button>
          ))}
        </div>
        {rule.base === "fixed" ? (
          <div className="relative mt-3">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
            <input
              value={rule.fixed_base}
              onChange={(e) => set({ fixed_base: e.target.value })}
              inputMode="decimal"
              required
              aria-label="Fixed monthly amount"
              placeholder="60000"
              className={`${inputClass} pl-7 tabular-nums`}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Targets grow as the month&rsquo;s income comes in.</p>
        )}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Rule name</span>
        <input
          value={rule.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={60}
          required
          className={inputClass}
        />
        <span className="text-sm text-muted">A name like 55/25/20 follows the shares when they change.</span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass.primary} w-fit`}>
          {pending ? "Saving…" : "Save rule"}
        </button>
        <p className="text-sm text-muted">Every month&rsquo;s targets follow the new rule, past months included.</p>
      </div>
    </form>
  );
}
