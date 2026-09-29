import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { allRows, TRANSACTION_COLUMNS } from "@/lib/data/paging";
import type { BudgetRule } from "@/lib/finance/budget";
import { addDays, istDate, istStartOf, periodContains, type Period } from "@/lib/finance/dates";
import type { BudgetBucket, Transaction } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

// The active budget rule and what the Budget screen needs (FR-7).

export type ActiveRule = BudgetRule & { id: string; name: string };

// The active rule, its buckets in order, and which bucket each subcategory is
// in. Every user gets one when their account is made (TD-13).
export const getActiveRule = cache(async (): Promise<ActiveRule | null> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budget_rules")
    .select("id, name, base, fixed_base, budget_buckets(id, name, share_bp, holds_savings, sort_order, bucket_assignments(subcategory_id))")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const rows = (data.budget_buckets as (BudgetBucket & {
    sort_order: number;
    bucket_assignments: { subcategory_id: string }[];
  })[]).sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: data.id,
    name: data.name,
    base: data.base,
    fixed_base: data.fixed_base === null ? null : Number(data.fixed_base),
    buckets: rows.map(({ id, name, share_bp, holds_savings }) => ({ id, name, share_bp, holds_savings })),
    assignments: new Map(rows.flatMap((b) => b.bucket_assignments.map((a) => [a.subcategory_id, b.id] as const))),
  };
});

// A budget month is at most 31 days, so this many days back always reaches
// the start of the budget month `months` before this one, whatever day
// months start on. Screens load that much before they know which day that
// is, in the same round as everything else, then keep the months they need
// with inMonths().
export function daysBackFor(months: number) {
  return (months + 1) * 31;
}

// How many days one request covers when a long range loads at once.
const SLICE_DAYS = 60;

// Every transaction from `days` days ago on, future-dated ones included. One
// request returns at most 1,000 rows, so instead of page after page the range
// comes as slices of SLICE_DAYS, all at the same time.
export const getRecentTransactions = cache(async (days: number): Promise<Transaction[]> => {
  await requireUser();
  const supabase = await createClient();
  const today = istDate(new Date());
  const starts: string[] = [];
  for (let day = addDays(today, -days); day <= today; day = addDays(day, SLICE_DAYS)) starts.push(day);
  const slices = await Promise.all(
    starts.map((start, i) =>
      allRows((from, to) => {
        let query = supabase.from("transactions").select(TRANSACTION_COLUMNS).gte("occurred_at", istStartOf(start).toISOString());
        // The last slice is open-ended, so it has planned entries still to come.
        if (i < starts.length - 1) query = query.lt("occurred_at", istStartOf(starts[i + 1]).toISOString());
        return query.order("occurred_at").order("id").range(from, to);
      }),
    ),
  );
  return slices.flat();
});

// The transactions from the start of `from` to the end of `to`.
export function inMonths(transactions: Transaction[], from: Period, to: Period): Transaction[] {
  const range = { start: from.start, end: to.end };
  return transactions.filter((t) => periodContains(range, t.occurred_at));
}

// The date of the owner's first entry, so months before it aren't judged.
export const getFirstEntryDate = cache(async (): Promise<string | null> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("occurred_at")
    .eq("is_planned", false)
    .neq("kind", "adjustment")
    .order("occurred_at")
    .limit(1);
  if (error) throw error;
  return data[0]?.occurred_at ?? null;
});
