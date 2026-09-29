import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import { getRecentTransactions } from "@/lib/data/budget";
import type { Entry } from "@/lib/data/entries";
import { addDays, istDate, istStartOf } from "@/lib/finance/dates";
import type { Commitment, Transaction } from "@/lib/finance/types";
import { allRows, TRANSACTION_COLUMNS } from "@/lib/data/paging";
import { createClient } from "@/lib/supabase/server";

// Recurring commitments and the transactions their screens need (FR-6).

export type CommitmentRow = Commitment & { name: string; created_at: string };

const COMMITMENT_COLUMNS =
  "id, name, kind, amount, is_variable, account_id, to_account_id, subcategory_id, unit, every, first_due_on, ends_on, paused_at, created_at, recurring_skips(due_on)";

function toCommitment(row: Record<string, unknown>): CommitmentRow {
  const { recurring_skips, ...rest } = row as CommitmentRow & { recurring_skips: { due_on: string }[] };
  return {
    ...rest,
    amount: Number(rest.amount),
    skipped_on: recurring_skips.map((s) => s.due_on).sort(),
  };
}

export const listCommitments = cache(async (): Promise<CommitmentRow[]> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_commitments").select(COMMITMENT_COLUMNS).order("name");
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(toCommitment);
});

export async function getCommitment(id: string): Promise<CommitmentRow> {
  await requireUser();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .select(COMMITMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return toCommitment(data as Record<string, unknown>);
}

// Every payment linked to a commitment, and every planned entry: what the
// due dates, Upcoming and reserved money are worked out from.
export const getScheduleTransactions = cache(async (): Promise<Transaction[]> => {
  await requireUser();
  const supabase = await createClient();
  const [linked, planned] = await Promise.all([
    allRows((from, to) =>
      supabase
        .from("transactions")
        .select(TRANSACTION_COLUMNS)
        .not("recurring_id", "is", null)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("transactions")
        .select(TRANSACTION_COLUMNS)
        .eq("is_planned", true)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  const byId = new Map([...linked, ...planned].map((t) => [t.id, t]));
  return [...byId.values()];
});

// How far back detection looks. Long enough for three payments every 6 months.
export const DETECTION_DAYS = 400;

// Confirmed expenses and transfers of the last DETECTION_DAYS that no
// commitment covers yet, to find recurring payments in (FR-6).
export async function getDetectionHistory(): Promise<Transaction[]> {
  const since = istStartOf(addDays(istDate(new Date()), -DETECTION_DAYS)).getTime();
  return (await getRecentTransactions(DETECTION_DAYS)).filter(
    (t) =>
      (t.kind === "expense" || t.kind === "transfer") &&
      !t.is_planned &&
      !t.recurring_id &&
      Date.parse(t.occurred_at) >= since,
  );
}

// The budget month start day (FR-12), for reserved money.
export const getBudgetMonthStartDay = cache(async (): Promise<number> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("budget_month_start_day").maybeSingle();
  if (error) throw error;
  return data?.budget_month_start_day ?? 1;
});

// A commitment's latest payments, newest first.
export async function getCommitmentPayments(id: string, limit = 24): Promise<Entry[]> {
  await requireUser();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, kind, amount, account_id, to_account_id, subcategory_id, note, description, occurred_at, is_planned")
    .eq("recurring_id", id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((t) => ({ ...(t as Entry), amount: Number(t.amount) }));
}
