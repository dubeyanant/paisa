import "server-only";
import { daysBackFor, getActiveRule, getFirstEntryDate, getRecentTransactions, inMonths } from "@/lib/data/budget";
import type { getLabels } from "@/lib/data/entries";
import type { getMoneySummary } from "@/lib/data/summary";
import { topAlerts } from "@/lib/finance/alerts";
import { budgetAdherence, plannedPayments } from "@/lib/finance/budget";
import { istDate, shiftBudgetMonth } from "@/lib/finance/dates";
import { recurringPayments } from "@/lib/finance/detection";
import { categoryTrends, everyday, monthToDatePace, savingsTrend } from "@/lib/finance/insights";

// Budget months of history before this one that Home's insights look at: the
// typical month (BR-10) and the budget streaks need up to 6.
const HISTORY_MONTHS = 6;

// The Home screen's insights (FR-8): everyday spending pace, last month's
// savings rate, budget buckets and the top alerts. Takes getMoneySummary()
// and getLabels() while they load, and starts its own loads alongside them,
// so the whole screen needs one round of queries.
export async function getHomeInsights(
  loadingSummary: ReturnType<typeof getMoneySummary>,
  loadingLabels: ReturnType<typeof getLabels>,
) {
  const [{ accounts, commitments, scheduled, month, today }, labels, recent, rule, firstEntry] = await Promise.all([
    loadingSummary,
    loadingLabels,
    getRecentTransactions(daysBackFor(HISTORY_MONTHS)),
    getActiveRule(),
    getFirstEntryDate(),
  ]);
  const history = inMonths(recent, shiftBudgetMonth(month, -HISTORY_MONTHS), month);
  // Commitment payments from before the window still decide which due date
  // each later payment covers (TD-16), so they're added in.
  const transactions = [...new Map([...scheduled, ...history].map((t) => [t.id, t])).values()];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const categoryOf = new Map(labels.subcategories.map((s) => [s.id, s.category_id]));
  const firstDate = firstEntry ? istDate(firstEntry) : null;

  // Planned payments (rent, bills) are known in advance, so pace leaves them out.
  const pace = monthToDatePace(everyday(transactions, commitments, today), accountsById, categoryOf, month, today, firstDate);
  const trends = categoryTrends(transactions, categoryOf, month, firstDate);
  const budget = rule
    ? budgetAdherence(transactions, rule, accountsById, month, today, HISTORY_MONTHS, plannedPayments(transactions, commitments, month, today))
    : null;
  const recurring = recurringPayments(commitments, transactions, today);
  // Overdue payments aren't among the alerts here: Due now, just below them,
  // already lists each one with a button to confirm it.
  const alerts = topAlerts({ pace, trends, recurring, budget: budget?.buckets });

  return {
    // A savings rate means something once the month is over: until then rent
    // and bills still to pay look like money saved. So it's last month's.
    savings: savingsTrend(transactions, accountsById, shiftBudgetMonth(month, -1), 2),
    pace,
    budget,
    alerts,
    firstDate,
  };
}
