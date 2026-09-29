"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isDate } from "@/lib/categories";
import { isUuid } from "@/lib/data/accounts";
import { parseRupees } from "@/lib/finance/money";
import { confirmedAt, isScheduledOn, parseCommitment, type CommitmentInput } from "@/lib/recurring";
import { createClient } from "@/lib/supabase/server";

// Planned payments (FR-6, TD-18): repeating ones (commitments) and their due
// dates, and one-off planned entries.

export type RecurringResult = { ok: true; id: string } | { ok: false; error: string };

const MISSING = "That commitment doesn't exist any more. Reload and try again.";
const OFFLINE = "Couldn't save. Please try again.";

function failed(what: string, error: { code?: string; message: string }): RecurringResult {
  if (error.code === "23503") return { ok: false, error: "That account or category no longer exists. Reload and try again." };
  console.error(`${what} failed:`, error.code, error.message);
  return { ok: false, error: OFFLINE };
}

export async function createCommitment(input: CommitmentInput): Promise<RecurringResult> {
  await requireUser();
  const parsed = parseCommitment(input);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_commitments").insert(parsed.row).select("id").single();
  if (error) return failed("Creating a commitment", error);
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function updateCommitment(id: string, input: CommitmentInput): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const parsed = parseCommitment(input);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const { data, error } = await supabase.from("recurring_commitments").update(parsed.row).eq("id", id).select("id");
  if (error) return failed("Updating a commitment", error);
  if (data.length === 0) return { ok: false, error: MISSING };
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// A payment planned once: a planned entry on the due date, at noon IST. It
// counts in planned money until it's confirmed from Due now (BR-7).
export async function createPlannedOnce(input: CommitmentInput): Promise<RecurringResult> {
  await requireUser();
  const parsed = parseCommitment({ ...input, unit: "month", every: 1, ends_on: "" });
  if (!parsed.ok) return parsed;
  const { row } = parsed;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      kind: row.kind,
      amount: row.amount,
      account_id: row.account_id,
      to_account_id: row.to_account_id,
      subcategory_id: row.subcategory_id,
      note: row.name,
      occurred_at: new Date(`${row.first_due_on}T12:00:00+05:30`).toISOString(),
      is_planned: true,
    })
    .select("id")
    .single();
  if (error) return failed("Planning a payment", error);
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

// A paused commitment has no due dates until it's resumed.
export async function setPaused(id: string, paused: boolean): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .update({ paused_at: paused ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) return failed("Pausing a commitment", error);
  if (data.length === 0) return { ok: false, error: MISSING };
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// Its payments stay, just no longer linked to it.
export async function deleteCommitment(id: string): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { error } = await supabase.from("recurring_commitments").delete().eq("id", id);
  if (error) return failed("Deleting a commitment", error);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

async function scheduledCommitment(id: string, dueOn: string) {
  if (!isUuid(id) || !isDate(dueOn)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_commitments")
    .select("id, name, kind, account_id, to_account_id, subcategory_id, unit, every, first_due_on")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data && isScheduledOn(data, dueOn) ? data : null;
}

// Records the payment for a due date (FR-6 AC1, AC3), at the amount confirmed.
// `paymentId` comes from the browser, so a retry can't pay twice.
export async function confirmDue(
  paymentId: string,
  commitmentId: string,
  dueOn: string,
  amount: string,
): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(paymentId)) return { ok: false, error: "Something went wrong. Reload and try again." };
  const paise = parseRupees(String(amount ?? ""));
  if (!paise) return { ok: false, error: "Enter the amount paid." };
  const c = await scheduledCommitment(commitmentId, dueOn);
  if (!c) return { ok: false, error: MISSING };

  const supabase = await createClient();
  const { error } = await supabase.from("transactions").insert({
    id: paymentId,
    kind: c.kind,
    amount: paise,
    account_id: c.account_id,
    to_account_id: c.to_account_id,
    subcategory_id: c.subcategory_id,
    note: c.name,
    occurred_at: confirmedAt(dueOn, new Date()).toISOString(),
    is_planned: false,
    recurring_id: c.id,
  });
  const retry = error?.code === "23505" && error.message.includes("transactions_pkey");
  if (error && !retry) return failed("Confirming a payment", error);
  revalidatePath("/", "layout");
  return { ok: true, id: paymentId };
}

// Nothing is due that day: a month the gym was closed, a bill that didn't come.
export async function skipDue(commitmentId: string, dueOn: string): Promise<RecurringResult> {
  await requireUser();
  const c = await scheduledCommitment(commitmentId, dueOn);
  if (!c) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_skips")
    .upsert({ recurring_id: c.id, due_on: dueOn }, { onConflict: "recurring_id,due_on", ignoreDuplicates: true });
  if (error) return failed("Skipping a due date", error);
  revalidatePath("/", "layout");
  return { ok: true, id: c.id };
}

export async function unskipDue(commitmentId: string, dueOn: string): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(commitmentId) || !isDate(dueOn)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_skips")
    .delete()
    .eq("recurring_id", commitmentId)
    .eq("due_on", dueOn);
  if (error) return failed("Undoing a skip", error);
  revalidatePath("/", "layout");
  return { ok: true, id: commitmentId };
}

// A planned entry whose date has come: it happened, so it now counts (BR-7).
export async function confirmPlanned(id: string): Promise<RecurringResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: "That entry doesn't exist any more." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .update({ is_planned: false })
    .eq("id", id)
    .lte("occurred_at", new Date().toISOString())
    .select("id");
  if (error) return failed("Confirming a planned entry", error);
  if (data.length === 0) return { ok: false, error: "That entry doesn't exist any more." };
  revalidatePath("/", "layout");
  return { ok: true, id };
}
