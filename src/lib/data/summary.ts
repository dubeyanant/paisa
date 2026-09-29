import "server-only";
import { listAccounts } from "@/lib/data/accounts";
import { getFunds, type FundRowState } from "@/lib/data/funds";
import { getBudgetMonthStartDay, getScheduleTransactions, listCommitments } from "@/lib/data/recurring";
import { balanceSummary } from "@/lib/finance/balances";
import { budgetMonthOf, istDate } from "@/lib/finance/dates";
import { fundBudget, fundStates, heldInFunds } from "@/lib/finance/funds";
import { plannedToPay } from "@/lib/finance/recurring";

// Balances and what's free to spend (TD-18, TD-21), the same on every screen.
// Also returns what it loaded, so a screen can reuse it.
export async function getMoneySummary(now = new Date()) {
  const [accounts, commitments, scheduled, startDay, { funds: fundRows, moves, spends }] = await Promise.all([
    listAccounts(),
    listCommitments(),
    getScheduleTransactions(),
    getBudgetMonthStartDay(),
    getFunds(),
  ]);
  const today = istDate(now);
  const month = budgetMonthOf(today, startDay);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const planned = plannedToPay(commitments, scheduled, accountsById, month, today);
  const funds = fundStates(fundRows, moves, spends, startDay, now) as FundRowState[];
  // Archived accounts still hold money (or debt), so they count.
  const summary = balanceSummary(
    accounts,
    new Map(accounts.map((a) => [a.id, a.balance])),
    planned,
    heldInFunds(funds),
  );
  return { summary, accounts, commitments, scheduled, month, today, startDay, funds, fundBudget: fundBudget(funds) };
}
