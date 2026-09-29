import { accountBalances, cardOutstanding } from "./balances";
import { addDays, daysBetween, istEndOf, type Period } from "./dates";
import { addMonths } from "./recurring";
import { actualsIn, spendingWhere } from "./totals";
import type { Account, Transaction } from "./types";

// INS-11 Credit card overview.

export type CardStatement = {
  // The last statement on or before today.
  date: string;
  // What the card owed when the statement closed.
  amount: number;
  // What's still due from it after payments, refunds and cashback since.
  due: number;
  dueOn: string;
  daysToDue: number;
};

export type CardOverview = {
  accountId: string;
  outstanding: number;
  // Null when the card has no statement day or due day.
  statement: CardStatement | null;
  // Cashback credited to this card this budget month and this calendar year.
  cashbackMonth: number;
  cashbackYear: number;
  // Spending on this card this calendar year.
  spendYear: number;
  // cashbackYear ÷ spendYear, or null with no spending.
  effectiveRate: number | null;
};

// `day` of the month `date` is in, or its last day if the month is shorter.
function clamp(date: string, day: number): string {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// The latest statement date on or before `today`.
export function lastStatementDate(statementDay: number, today: string): string {
  const thisMonth = clamp(today, statementDay);
  return thisMonth <= today ? thisMonth : clamp(addMonths(`${today.slice(0, 8)}01`, -1), statementDay);
}

// The first due day after the statement date.
export function statementDueDate(statementDate: string, dueDay: number): string {
  const sameMonth = clamp(statementDate, dueDay);
  return sameMonth > statementDate ? sameMonth : clamp(addMonths(`${statementDate.slice(0, 8)}01`, 1), dueDay);
}

// Money into the card in the period: payments, refunds and cashback.
function paidInto(transactions: Transaction[], cardId: string, period: Period): number {
  let paid = 0;
  for (const t of actualsIn(transactions, period)) {
    if (t.kind === "transfer" && t.to_account_id === cardId) paid += t.amount;
    else if ((t.kind === "refund" || t.kind === "income") && t.account_id === cardId) paid += t.amount;
  }
  return paid;
}

export function cardOverview(
  card: Account,
  transactions: Transaction[],
  cashback: Set<string>,
  current: Period,
  today: string,
): CardOverview {
  const own = transactions.filter((t) => t.account_id === card.id || t.to_account_id === card.id);
  const owedAt = (date: string) =>
    cardOutstanding(accountBalances([card], own, istEndOf(date)).get(card.id)!);

  let statement: CardStatement | null = null;
  if (card.statement_day && card.due_day) {
    const date = lastStatementDate(card.statement_day, today);
    const amount = owedAt(date);
    const paid = paidInto(own, card.id, { start: addDays(date, 1), end: addDays(today, 1) });
    const dueOn = statementDueDate(date, card.due_day);
    statement = {
      date,
      amount,
      due: Math.max(0, amount - paid),
      dueOn,
      daysToDue: daysBetween(today, dueOn),
    };
  }

  const year = today.slice(0, 4);
  const thisYear: Period = { start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` };
  const onCard = (t: Transaction) => t.account_id === card.id;
  const cashbackIn = (period: Period) =>
    actualsIn(own, period)
      .filter((t) => onCard(t) && t.kind === "income" && cashback.has(t.subcategory_id!))
      .reduce((sum, t) => sum + t.amount, 0);
  const cashbackYear = cashbackIn(thisYear);
  const spendYear = spendingWhere(own, thisYear, onCard);
  return {
    accountId: card.id,
    outstanding: owedAt(today),
    statement,
    cashbackMonth: cashbackIn(current),
    cashbackYear,
    spendYear,
    effectiveRate: spendYear > 0 ? cashbackYear / spendYear : null,
  };
}
