import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/data/accounts";
import { allRows, TRANSACTION_COLUMNS } from "@/lib/data/paging";
import type { Fund, FundMove, FundState } from "@/lib/finance/funds";
import type { Transaction } from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

// Funds (TD-21) and what their balances are worked out from.

export type FundRow = Fund & { name: string; created_at: string };
export type FundRowState = FundState & { fund: FundRow };

const FUND_COLUMNS =
  "id, name, kind, bucket_id, target, monthly_amount, cap, schedule_from, ends_on, closed_at, created_at";

const amountOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function toFund(row: Record<string, unknown>): FundRow {
  const fund = row as FundRow;
  return {
    ...fund,
    target: amountOrNull(fund.target),
    monthly_amount: amountOrNull(fund.monthly_amount),
    cap: amountOrNull(fund.cap),
  };
}

// Every fund, its moves, and every transaction paid from one: few rows, so
// all of them load in one round.
export const getFunds = cache(async (): Promise<{ funds: FundRow[]; moves: FundMove[]; spends: Transaction[] }> => {
  await requireUser();
  const supabase = await createClient();
  const [funds, moves, spends] = await Promise.all([
    supabase.from("funds").select(FUND_COLUMNS).order("created_at"),
    supabase.from("fund_moves").select("fund_id, amount, occurred_at, is_monthly").order("occurred_at").limit(10000),
    allRows((from, to) =>
      supabase
        .from("transactions")
        .select(`${TRANSACTION_COLUMNS}, fund_id`)
        .not("fund_id", "is", null)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (funds.error) throw funds.error;
  if (moves.error) throw moves.error;
  return {
    funds: (funds.data as Record<string, unknown>[]).map(toFund),
    moves: moves.data.map((m) => ({ ...(m as FundMove), amount: Number(m.amount) })),
    spends,
  };
});

export async function getFund(id: string): Promise<FundRow> {
  await requireUser();
  if (!isUuid(id)) notFound();
  const { funds } = await getFunds();
  const fund = funds.find((f) => f.id === id);
  if (!fund) notFound();
  return fund;
}
