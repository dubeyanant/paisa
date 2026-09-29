import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { getFirstEntryDate, getRecentTransactions, inMonths } from "@/lib/data/budget";
import { getLabels } from "@/lib/data/entries";
import { DETECTION_DAYS, getDetectionHistory } from "@/lib/data/recurring";
import { getMoneySummary } from "@/lib/data/summary";
import { addDays, istDate, shiftBudgetMonth } from "@/lib/finance/dates";
import { recurringPayments } from "@/lib/finance/detection";
import {
  categoryTrends,
  emergencyFundCoverage,
  everyday,
  monthToDatePace,
  savingsTrend,
  smallSpendLeak,
} from "@/lib/finance/insights";
import { createClient } from "@/lib/supabase/server";

// Budget months of history before this one: the typical month (BR-10) and the
// 6-month trends need up to 6.
const HISTORY_MONTHS = 6;

// The small-spend threshold for INS-06, in paise (₹200 unless changed).
export const getSmallSpendThreshold = cache(async (): Promise<number> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("small_spend_threshold").maybeSingle();
  if (error) throw error;
  return data ? Number(data.small_spend_threshold) : 20000;
});

// Everything the Insights screen shows (FR-8.4), worked out from the last 6
// budget months, the past year of payments for recurring ones (INS-09), and
// balances from the database (TD-15).
export async function getInsights(now = new Date()) {
  // Detection's 400 days reach back further than the 7 budget months, so one
  // load serves both, in the same round as everything else.
  const [{ accounts, commitments, scheduled, month, today }, labels, recent, detection, firstEntry, threshold] =
    await Promise.all([
      getMoneySummary(now),
      getLabels(),
      getRecentTransactions(DETECTION_DAYS),
      getDetectionHistory(),
      getFirstEntryDate(),
      getSmallSpendThreshold(),
    ]);
  const history = inMonths(recent, shiftBudgetMonth(month, -HISTORY_MONTHS), month);
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
    // Finished months only: until a month ends, rent and bills still to pay
    // look like money saved.
    savings: savingsTrend(transactions, accountsById, shiftBudgetMonth(month, -1), HISTORY_MONTHS),
    emergency: emergencyFundCoverage(transactions, accounts, month, firstDate, balances),
    // Planned payments (rent, bills) are known in advance, so pace leaves them out.
    pace: monthToDatePace(everyday(transactions, commitments, today), accountsById, categoryOf, month, today, firstDate),
    trends: categoryTrends(transactions, categoryOf, month, firstDate),
    // The last 30 days, so it's a full month's worth on any day.
    smallSpends: smallSpendLeak(transactions, { start: addDays(today, -29), end: addDays(today, 1) }, threshold),
    // Paying a card bill isn't a cost of its own: what was bought on the card
    // already counts as spending.
    recurring: recurringPayments(commitments, transactions, today).filter((p) => {
      const to = p.commitment?.to_account_id ?? p.series?.to_account_id;
      return !to || accountsById.get(to)?.type !== "credit_card";
    }),
  };
}
