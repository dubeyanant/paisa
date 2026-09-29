import "server-only";
import { requireUser } from "@/lib/auth";
import { allRows, TRANSACTION_COLUMNS } from "@/lib/data/paging";
import type { BudgetRule } from "@/lib/finance/budget";
import { istStartOf, type Period } from "@/lib/finance/dates";
import type { BudgetBucket, Transaction } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

// The active budget rule and what the Budget screen needs (FR-7).

export type ActiveRule = BudgetRule & { id: string; name: string };

// The active rule, its buckets in order, and which bucket each subcategory is
// in. Every user gets one when their account is made (TD-13).
export async function getActiveRule(): Promise<ActiveRule | null> {
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
}

// Every transaction from the start of `from` to the end of `to`: enough for
// a month's figures and the months of history before it.
export async function getTransactionsBetween(from: Period, to: Period): Promise<Transaction[]> {
  await requireUser();
  const supabase = await createClient();
  return allRows((start, end) =>
    supabase
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
      .gte("occurred_at", istStartOf(from.start).toISOString())
      .lt("occurred_at", istStartOf(to.end).toISOString())
      .order("occurred_at")
      .order("id")
      .range(start, end),
  );
}

// The date of the owner's first entry, so months before it aren't judged.
export async function getFirstEntryDate(): Promise<string | null> {
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
}
