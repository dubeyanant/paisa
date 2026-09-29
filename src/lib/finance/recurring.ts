import { addDays, istDate, type Period } from "./dates";
import { assertPaise } from "./money";
import type { Account, Commitment, Transaction } from "./types";

// Recurring commitments (FR-6). A commitment is a template: its due dates come
// from the schedule, and a due date is paid once a transaction linked to the
// commitment (recurring_id) covers it. Linked payments cover due dates in
// order, the first payment the first due date and so on, so paying early or
// late still counts, and editing the amount (a variable bill) doesn't matter.
// A skipped due date isn't due at all, so no payment covers it.

// `date` moved by `months` whole months. A day that doesn't exist in the target
// month (the 31st in June, 29 February) falls on its last day.
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

// The nth due date of a commitment (0 is first_due_on). Always counted from
// first_due_on, so a rent due on the 31st is due on the 31st again after June.
export function nthDueDate(c: Pick<Commitment, "unit" | "every" | "first_due_on">, n: number): string {
  const step = c.every * n;
  if (c.unit === "week") return addDays(c.first_due_on, 7 * step);
  return addMonths(c.first_due_on, c.unit === "year" ? 12 * step : step);
}

// Every due date before `until` (exclusive), leaving out skipped ones. A paused
// commitment has none.
export function dueDates(c: Commitment, until: string): string[] {
  if (c.paused_at) return [];
  const skipped = new Set(c.skipped_on);
  const dates: string[] = [];
  for (let n = 0; ; n++) {
    const date = nthDueDate(c, n);
    if (date >= until || (c.ends_on && date > c.ends_on)) return dates;
    if (!skipped.has(date)) dates.push(date);
  }
}

// Linked payments per commitment, oldest first. Planned entries count: a
// future-dated rent entry already covers that month's rent.
export function paymentsByCommitment(transactions: Transaction[]): Map<string, Transaction[]> {
  const byCommitment = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.recurring_id) continue;
    const list = byCommitment.get(t.recurring_id) ?? [];
    list.push(t);
    byCommitment.set(t.recurring_id, list);
  }
  for (const list of byCommitment.values()) {
    list.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  }
  return byCommitment;
}

export type Due = {
  commitment: Commitment;
  due_on: string;
  // The payment covering this due date, or null while it's unpaid.
  payment: Transaction | null;
};

// Every due date of every commitment before `until`, with its payment.
export function dues(
  commitments: Commitment[],
  payments: Map<string, Transaction[]>,
  until: string,
): Due[] {
  return commitments.flatMap((commitment) => {
    const paid = payments.get(commitment.id) ?? [];
    return dueDates(commitment, until).map((due_on, i) => ({
      commitment,
      due_on,
      payment: paid[i] ?? null,
    }));
  });
}

// Due dates up to and including `today` that nobody has paid yet. Each one is a
// pending entry the owner confirms with one tap (FR-6 AC1).
export function pendingDues(
  commitments: Commitment[],
  payments: Map<string, Transaction[]>,
  today: string,
): Due[] {
  return dues(commitments, payments, addDays(today, 1)).filter((d) => !d.payment);
}

// Commitments due in the period (INS-01): what was paid for the ones already
// paid, and the expected amount for the rest.
export function committedIn(
  commitments: Commitment[],
  payments: Map<string, Transaction[]>,
  period: Period,
): number {
  let total = 0;
  for (const d of dues(commitments, payments, period.end)) {
    if (d.due_on < period.start) continue;
    const amount = d.payment ? d.payment.amount : d.commitment.amount;
    assertPaise(amount);
    total += amount;
  }
  return total;
}

export type UpcomingItem = {
  date: string;
  amount: number;
  // An unpaid due date of a commitment, or a planned entry (BR-7).
  commitment_id: string | null;
  transaction_id: string | null;
  // Due before today and still not paid or confirmed.
  overdue: boolean;
};

// Money going out: unpaid due dates and planned expenses and transfers. Income
// isn't included, and neither is a planned entry already covering a due date
// twice: it shows once, as the planned entry.
function outgoing(
  commitments: Commitment[],
  transactions: Transaction[],
  today: string,
  until: string,
): UpcomingItem[] {
  const payments = paymentsByCommitment(transactions);
  const items: UpcomingItem[] = dues(commitments, payments, until)
    .filter((d) => !d.payment)
    .map((d) => ({
      date: d.due_on,
      amount: d.commitment.amount,
      commitment_id: d.commitment.id,
      transaction_id: null,
      overdue: d.due_on < today,
    }));
  for (const t of transactions) {
    if (!t.is_planned || (t.kind !== "expense" && t.kind !== "transfer")) continue;
    const date = istDate(t.occurred_at);
    if (date >= until) continue;
    items.push({
      date,
      amount: t.amount,
      commitment_id: t.recurring_id ?? null,
      transaction_id: t.id,
      overdue: date < today,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export type Upcoming = { items: UpcomingItem[]; total: number };

// What's due in the next `days` days, overdue items included (FR-6, INS-10).
export function upcoming(
  commitments: Commitment[],
  transactions: Transaction[],
  today: string,
  days = 30,
): Upcoming {
  const items = outgoing(commitments, transactions, today, addDays(today, days + 1));
  return { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
}

// Money set aside for what's still to pay this budget month (FR-6 AC2): unpaid
// due dates and planned outgoing entries up to the end of the period, overdue
// ones included.
export function reservedIn(
  commitments: Commitment[],
  transactions: Transaction[],
  period: Period,
  today: string,
): number {
  return outgoing(commitments, transactions, today, period.end).reduce((sum, i) => sum + i.amount, 0);
}

// Planned money still to pay this budget month that will take money out of
// bank and cash (TD-18): reservedIn(), leaving out what doesn't touch the money
// available to spend:
// - payments from a set-aside account (a sinking fund pays its own), or from a
//   savings, deposit or loan account
// - transfers into a credit card (card dues already count) or into an ordinary
//   bank or wallet account (the money stays available)
// A planned expense on a credit card counts: it becomes card dues.
export function plannedToPay(
  commitments: Commitment[],
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  period: Period,
  today: string,
): number {
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const transactionById = new Map(transactions.map((t) => [t.id, t]));
  const spendable = (a: Account | undefined) =>
    a !== undefined && (a.type === "bank" || a.type === "wallet") && !a.is_blocked;
  let total = 0;
  for (const item of outgoing(commitments, transactions, today, period.end)) {
    const source = item.transaction_id ? transactionById.get(item.transaction_id) : commitmentById.get(item.commitment_id!);
    if (!source) continue;
    const from = accountsById.get(source.account_id);
    if (!from || (!spendable(from) && from.type !== "credit_card")) continue;
    if (source.kind === "transfer") {
      const to = accountsById.get(source.to_account_id ?? "");
      if (!to || to.type === "credit_card" || spendable(to)) continue;
    }
    total += item.amount;
  }
  return total;
}

// What a commitment costs per month and per year, rounded to the paisa (INS-09).
export function recurringCost(amount: number, c: Pick<Commitment, "unit" | "every">) {
  const perYear = { week: 52, month: 12, year: 1 }[c.unit];
  return {
    monthly: Math.round((amount * perYear) / (12 * c.every)),
    yearly: Math.round((amount * perYear) / c.every),
  };
}
