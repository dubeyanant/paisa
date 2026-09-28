import { periodContains, type Period } from "./dates";
import { assertPaise } from "./money";
import type { Account, Transaction } from "./types";

export type PeriodTotals = {
  income: number;
  // Expenses minus refunds (BR-1, BR-6). Transfers, card bill payments and
  // adjustments never count (BR-3, BR-4, BR-13).
  spending: number;
  // Transfers into savings accounts from other accounts (BR-5, BR-9).
  invested: number;
  // Transfers out of savings accounts to other accounts (BR-5).
  withdrawn: number;
};

// A transfer's effect on savings: +amount into savings, −amount out of it, and
// 0 between two savings accounts or two everyday accounts.
export function savingsFlow(t: Transaction, accountsById: Map<string, Account>): number {
  if (t.kind !== "transfer") return 0;
  const fromSavings = accountsById.get(t.account_id)?.type === "savings";
  const toSavings = accountsById.get(t.to_account_id!)?.type === "savings";
  if (toSavings && !fromSavings) return t.amount;
  if (fromSavings && !toSavings) return -t.amount;
  return 0;
}

// Confirmed transactions in the period. Planned ones don't count yet (BR-7).
export function actualsIn(transactions: Transaction[], period: Period): Transaction[] {
  return transactions.filter((t) => !t.is_planned && periodContains(period, t.occurred_at));
}

export function periodTotals(
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  period: Period,
): PeriodTotals {
  const totals: PeriodTotals = { income: 0, spending: 0, invested: 0, withdrawn: 0 };
  for (const t of actualsIn(transactions, period)) {
    assertPaise(t.amount);
    if (t.kind === "income") totals.income += t.amount;
    else if (t.kind === "expense") totals.spending += t.amount;
    else if (t.kind === "refund") totals.spending -= t.amount;
    else if (t.kind === "transfer") {
      const flow = savingsFlow(t, accountsById);
      if (flow > 0) totals.invested += flow;
      else totals.withdrawn -= flow;
    }
  }
  return totals;
}

// Spending per subcategory in the period, refunds netted off (BR-6).
export function spendingBySubcategory(
  transactions: Transaction[],
  period: Period,
): Map<string, number> {
  const bySubcategory = new Map<string, number>();
  for (const t of actualsIn(transactions, period)) {
    if (t.kind !== "expense" && t.kind !== "refund") continue;
    const signed = t.kind === "expense" ? t.amount : -t.amount;
    bySubcategory.set(t.subcategory_id!, (bySubcategory.get(t.subcategory_id!) ?? 0) + signed);
  }
  return bySubcategory;
}

// (income − spending) ÷ income for the budget month (BR-9). Null when there's
// no income to divide by.
export function savingsRate({ income, spending }: PeriodTotals): number | null {
  return income > 0 ? (income - spending) / income : null;
}

// The average of whole-month totals, rounded to the nearest paisa (BR-10).
// Null when there are no months to average yet.
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}
