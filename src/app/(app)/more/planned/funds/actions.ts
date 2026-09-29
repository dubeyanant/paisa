"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import { getFunds } from "@/lib/data/funds";
import { getBudgetMonthStartDay } from "@/lib/data/recurring";
import { budgetMonthOf, istDate } from "@/lib/finance/dates";
import { fundState } from "@/lib/finance/funds";
import { formatINR, parseRupees } from "@/lib/finance/money";
import { fundChange, parseFundChange, parseNewFund, type FundInput } from "@/lib/funds";
import { createClient } from "@/lib/supabase/server";

// Funds (TD-21): money kept in the bank for a goal or an ongoing purpose.

export type FundResult = { ok: true; id: string } | { ok: false; error: string };

const MISSING = "That fund doesn't exist any more. Reload and try again.";
const OFFLINE = "Couldn't save. Please try again.";

function failed(what: string, error: { code?: string; message: string }): FundResult {
  if (error.code === "23503") return { ok: false, error: "That budget bucket no longer exists. Reload and try again." };
  console.error(`${what} failed:`, error.code, error.message);
  return { ok: false, error: OFFLINE };
}

// The fund as it stands now, and the budget month, for changes that depend on
// its balance or schedule.
async function current(id: string) {
  const [{ funds, moves, spends }, startDay] = await Promise.all([getFunds(), getBudgetMonthStartDay()]);
  const fund = funds.find((f) => f.id === id);
  if (!fund) return null;
  const now = new Date();
  return {
    state: fundState(fund, moves.filter((m) => m.fund_id === id), spends.filter((t) => t.fund_id === id), startDay, now),
    month: budgetMonthOf(istDate(now), startDay),
    startDay,
    now,
  };
}

export async function createFund(input: FundInput): Promise<FundResult> {
  await requireUser();
  const month = budgetMonthOf(istDate(new Date()), await getBudgetMonthStartDay());
  const parsed = parseNewFund(input, month);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const { data, error } = await supabase.from("funds").insert(parsed.row).select("id").single();
  if (error) return failed("Creating a fund", error);
  if (parsed.putIn > 0) {
    const { error: moveError } = await supabase
      .from("fund_moves")
      .insert({ fund_id: data.id, amount: parsed.putIn, occurred_at: new Date().toISOString() });
    if (moveError) {
      console.error("Putting money in a new fund failed:", moveError.code, moveError.message);
      revalidatePath("/", "layout");
      return { ok: false, error: "The fund was made, but the money wasn't put in. Add it from the fund's screen." };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

// A new schedule keeps the months already finished as they were (TD-21).
export async function updateFund(id: string, input: FundInput): Promise<FundResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const now = await current(id);
  if (!now) return { ok: false, error: MISSING };
  if (now.state.closedAt) return { ok: false, error: "This fund is closed, so it can't change." };
  const parsed = parseFundChange(now.state.fund, input, now.month, now.startDay);
  if (!parsed.ok) return parsed;
  const { row, kept } = fundChange(now.state, parsed.row, now.month, now.startDay);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_fund", {
    fund: id,
    new_name: row.name,
    new_bucket: row.bucket_id,
    new_target: row.target,
    new_monthly: row.monthly_amount,
    new_cap: row.cap,
    new_schedule_from: row.schedule_from,
    new_ends_on: row.ends_on,
    kept,
  });
  if (error?.code === "P0002") return { ok: false, error: MISSING };
  if (error) return failed("Changing a fund", error);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// Money added by hand, or taken back out to be free to spend again. `moveId`
// comes from the browser, so a retry can't move the money twice.
export async function moveMoney(moveId: string, id: string, direction: "in" | "out", amount: string): Promise<FundResult> {
  await requireUser();
  if (!isUuid(moveId)) return { ok: false, error: "Something went wrong. Reload and try again." };
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const paise = parseRupees(String(amount ?? ""));
  if (!paise) return { ok: false, error: "Enter an amount." };
  const now = await current(id);
  if (!now) return { ok: false, error: MISSING };
  if (now.state.closedAt) return { ok: false, error: "This fund is closed." };
  if (direction === "out" && paise > now.state.balance) {
    return { ok: false, error: `The fund holds ${formatINR(now.state.balance)}, so you can take out up to that.` };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("fund_moves")
    .insert({ id: moveId, fund_id: id, amount: direction === "in" ? paise : -paise, occurred_at: now.now.toISOString() });
  const retry = error?.code === "23505" && error.message.includes("fund_moves_pkey");
  if (error && !retry) return failed("Moving money in a fund", error);
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// What it holds becomes free to spend again. Its history stays.
export async function closeFund(id: string): Promise<FundResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("funds")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", id)
    .is("closed_at", null)
    .select("id");
  if (error) return failed("Closing a fund", error);
  if (data.length === 0) return { ok: false, error: MISSING };
  revalidatePath("/", "layout");
  return { ok: true, id };
}

// Only a fund that paid for nothing: otherwise it's closed, so history stays.
export async function deleteFund(id: string): Promise<FundResult> {
  await requireUser();
  if (!isUuid(id)) return { ok: false, error: MISSING };
  const supabase = await createClient();
  const { error } = await supabase.from("funds").delete().eq("id", id);
  if (error?.code === "23503") return { ok: false, error: "This fund paid for entries, so it can only be closed." };
  if (error) return failed("Deleting a fund", error);
  revalidatePath("/", "layout");
  return { ok: true, id };
}
