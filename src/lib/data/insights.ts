import "server-only";
import { requireUser } from "@/lib/auth";
import { getActiveRule, getFirstEntryDate, getTransactionsBetween } from "@/lib/data/budget";
import { getLabels } from "@/lib/data/entries";
import { getDetectionHistory } from "@/lib/data/recurring";
import { getMoneySummary } from "@/lib/data/summary";
import { budgetAdherence } from "@/lib/finance/budget";
import { istDate, shiftBudgetMonth } from "@/lib/finance/dates";
import { recurringPayments } from "@/lib/finance/detection";
import {
  categoryTrends,
  emergencyFundCoverage,
  monthToDatePace,
  savingsTrend,
  smallSpendLeak,
} from "@/lib/finance/insights";
import { upcoming } from "@/lib/finance/recurring";
import { createClient } from "@/lib/supabase/server";

// Budget months of history before this one: the typical month (BR-10), the
// 6-month trends and the budget streaks need up to 6.
const HISTORY_MONTHS = 6;

// The small-spend threshold for INS-06, in paise (₹200 unless changed).
export async function getSmallSpendThreshold(): Promise<number> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("small_spend_threshold").maybeSingle();
  if (error) throw error;
  return data ? Number(data.small_spend_threshold) : 20000;
}

// Everything the Insights screen shows (FR-8.4), worked out from the last 6
// budget months, the past year of payments for recurring ones (INS-09), and
// balances from the database (TD-15).
export async function getInsights(now = new Date()) {
  const [{ accounts, commitments, scheduled, month, today }, labels, detection, rule, firstEntry, threshold] =
    await Promise.all([
      getMoneySummary(now),
      getLabels(),
      getDetectionHistory(),
      getActiveRule(),
      getFirstEntryDate(),
      getSmallSpendThreshold(),
    ]);
  const history = await getTransactionsBetween(shiftBudgetMonth(month, -HISTORY_MONTHS), month);
  // Commitment payments from before the window still decide which due date
  // each later payment covers (TD-16), so they're added in.
  const transactions = [...new Map([...scheduled, ...detection, ...history].map((t) => [t.id, t])).values()];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const categoryOf = new Map(labels.subcategories.map((s) => [s.id, s.category_id]));
  const firstDate = firstEntry ? istDate(firstEntry) : null;
  const balances = new Map(accounts.map((a) => [a.id, a.balance]));

  return {
    labels,
    accounts,
    commitments,
    scheduled,
    month,
    today,
    firstDate,
    threshold,
    savings: savingsTrend(transactions, accountsById, month, HISTORY_MONTHS),
    emergency: emergencyFundCoverage(transactions, accounts, month, firstDate, balances),
    pace: monthToDatePace(transactions, accountsById, categoryOf, month, today, firstDate),
    trends: categoryTrends(transactions, categoryOf, month, firstDate),
    smallSpends: smallSpendLeak(transactions, month, threshold),
    // Paying a card bill isn't a cost of its own: what was bought on the card
    // already counts as spending.
    recurring: recurringPayments(commitments, transactions, today).filter((p) => {
      const to = p.commitment?.to_account_id ?? p.series?.to_account_id;
      return !to || accountsById.get(to)?.type !== "credit_card";
    }),
    upcoming: upcoming(commitments, scheduled, today),
    budget: rule ? { rule, ...budgetAdherence(transactions, rule, accountsById, month, today, HISTORY_MONTHS) } : null,
  };
}
