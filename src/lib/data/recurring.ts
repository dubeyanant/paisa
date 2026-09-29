import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import type { Entry } from "@/lib/data/entries";
import { addDays, istDate, istStartOf } from "@/lib/finance/dates";
import type { Commitment, Transaction } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

// Recurring commitments and the transactions their screens need (FR-6).

export type CommitmentRow = Commitment & { name: string; created_at: string };

const COMMITMENT_COLUMNS =
  "id, name, kind, amount, is_variable, account_id, to_account_id, subcategory_id, unit, every, first_due_on, ends_on, paused_at, created_at, recurring_skips(due_on)";

const TRANSACTION_COLUMNS =
  "id, kind, occurred_at, amount, account_id, to_account_id, subcategory_id, is_planned, bucket_override_id, note, recurring_id";

// The API returns at most 1,000 rows a request, so longer lists come in pages.
const PAGE = 1000;
const MAX_PAGES = 10;

// `page` fetches rows `from` to `to`, in a fixed order.
async function allRows(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: Error | null }>,
): Promise<Transaction[]> {
  const rows: Transaction[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const { data, error } = await page(n * PAGE, (n + 1) * PAGE - 1);
    if (error) throw error;
    rows.push(...(data as Record<string, unknown>[]).map(toTransaction));
    if (data!.length < PAGE) break;
  }
  return rows;
}

function toTransaction(row: Record<string, unknown>): Transaction {
  return { ...(row as Transaction), amount: Number(row.amount) };
}

function toCommitment(row: Record<string, unknown>): CommitmentRow {
  const { recurring_skips, ...rest } = row as CommitmentRow & { recurring_skips: { due_on: string }[] };
  return {
    ...rest,
    amount: Number(rest.amount),
    skipped_on: recurring_skips.map((s) => s.due_on).sort(),
  };
}

export async function listCommitments(): Promise<CommitmentRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_commitments").select(COMMITMENT_COLUMNS).order("name");
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(toCommitment);
}

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
export async function getScheduleTransactions(): Promise<Transaction[]> {
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
}

// How far back detection looks. Long enough for three payments every 6 months.
const DETECTION_DAYS = 400;

// Confirmed expenses and transfers of the last DETECTION_DAYS that no
// commitment covers yet, to find recurring payments in (FR-6).
export async function getDetectionHistory(): Promise<Transaction[]> {
  await requireUser();
  const supabase = await createClient();
  const since = addDays(istDate(new Date()), -DETECTION_DAYS);
  return allRows((from, to) =>
    supabase
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
      .in("kind", ["expense", "transfer"])
      .eq("is_planned", false)
      .is("recurring_id", null)
      .gte("occurred_at", istStartOf(since).toISOString())
      .order("occurred_at")
      .order("id")
      .range(from, to),
  );
}

// The budget month start day (FR-12), for reserved money.
export async function getBudgetMonthStartDay(): Promise<number> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("budget_month_start_day").maybeSingle();
  if (error) throw error;
  return data?.budget_month_start_day ?? 1;
}

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
