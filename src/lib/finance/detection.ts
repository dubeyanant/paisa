import { daysBetween, istDate } from "./dates";
import { nthDueDate, paymentsByCommitment, recurringCost } from "./recurring";
import type { Commitment, Transaction } from "./types";

// Finding recurring payments in the history (FR-6) and tracking what they cost
// (INS-09).

type Schedule = Pick<Commitment, "unit" | "every">;

// Gaps in days a payment may drift by and still count as the same schedule.
const SCHEDULES: { schedule: Schedule; min: number; max: number }[] = [
  { schedule: { unit: "week", every: 1 }, min: 6, max: 8 },
  { schedule: { unit: "month", every: 1 }, min: 24, max: 37 },
  { schedule: { unit: "month", every: 3 }, min: 85, max: 97 },
  { schedule: { unit: "month", every: 6 }, min: 175, max: 190 },
  { schedule: { unit: "year", every: 1 }, min: 350, max: 380 },
];

// At most this many of the latest payments decide whether a series is regular.
const RECENT = 6;

// Notes that differ only in case, digits or punctuation ("Rent Sep", "rent
// oct") count as the same.
export function noteKey(note: string | null | undefined): string {
  return (note ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function seriesKey(t: Transaction): string | null {
  if (t.kind === "expense") return `expense|${t.subcategory_id}|${noteKey(t.note)}`;
  if (t.kind === "transfer") return `transfer|${t.account_id}|${t.to_account_id}|${noteKey(t.note)}`;
  return null;
}

// The schedule every gap between the dates fits, if any.
function scheduleOf(dates: string[]): { schedule: Schedule; max: number } | null {
  const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i], date));
  const match = SCHEDULES.find(({ min, max }) => gaps.every((g) => g >= min && g <= max));
  return match ? { schedule: match.schedule, max: match.max } : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type RecurringSeries = Schedule & {
  key: string;
  kind: "expense" | "transfer";
  subcategory_id: string | null;
  account_id: string;
  to_account_id: string | null;
  // The latest payment's note, as the owner typed it.
  note: string | null;
  // The latest payments that form the series, oldest first.
  payments: Transaction[];
  // The latest amount, and when the next one is likely due.
  amount: number;
  next_due_on: string;
};

// Confirmed expenses and transfers that aren't linked to a commitment but
// repeat like one: same subcategory (or the same two accounts) and note,
// amounts within half of each other, a regular gap, and still going as of
// `today`. Series a commitment already covers are left out.
export function detectRecurring(
  transactions: Transaction[],
  commitments: Commitment[],
  today: string,
  minPayments = 3,
): RecurringSeries[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.is_planned || t.recurring_id || istDate(t.occurred_at) > today) continue;
    const key = seriesKey(t);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const found: RecurringSeries[] = [];
  for (const [key, group] of groups) {
    if (group.length < minPayments) continue;
    const recent = group
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
      .slice(-RECENT);
    const dates = recent.map((t) => istDate(t.occurred_at));
    const match = scheduleOf(dates);
    if (!match) continue;
    const last = dates[dates.length - 1];
    if (daysBetween(last, today) > match.max) continue; // stopped

    const typical = median(recent.map((t) => t.amount));
    if (recent.some((t) => 2 * t.amount < typical || t.amount > 2 * typical)) continue;

    const latest = recent[recent.length - 1];
    const series: RecurringSeries = {
      ...match.schedule,
      key,
      kind: latest.kind as "expense" | "transfer",
      subcategory_id: latest.subcategory_id,
      account_id: latest.account_id,
      to_account_id: latest.to_account_id,
      note: latest.note ?? null,
      payments: recent,
      amount: latest.amount,
      next_due_on: nthDueDate({ ...match.schedule, first_due_on: last }, 1),
    };
    if (!commitments.some((c) => covers(c, series))) found.push(series);
  }
  return found.sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));
}

// A commitment covers a series that pays the same thing at a similar amount.
function covers(c: Commitment, s: RecurringSeries): boolean {
  if (c.kind !== s.kind) return false;
  const same =
    c.kind === "expense"
      ? c.subcategory_id === s.subcategory_id
      : c.account_id === s.account_id && c.to_account_id === s.to_account_id;
  return same && 2 * s.amount >= c.amount && s.amount <= 2 * c.amount;
}

export type PriceChange = { from: number; to: number; on: string };

export type RecurringPayment = {
  commitment: Commitment | null;
  series: RecurringSeries | null;
  schedule: Schedule;
  // The latest charge, or the expected amount if nothing is paid yet.
  amount: number;
  monthly: number;
  yearly: number;
  priceChange: PriceChange | null;
};

// A change of 1% or more between the last two charges (INS-09). A variable bill
// (electricity) changes every time, so it's flagged only when the earlier
// charges were all the same: 149, 149 → 199 is a change, 900, 1,100 → 1,250
// isn't.
export function priceChange(charges: Transaction[], variable: boolean): PriceChange | null {
  const confirmed = charges.filter((t) => !t.is_planned);
  if (confirmed.length < 2) return null;
  const to = confirmed[confirmed.length - 1];
  const from = confirmed[confirmed.length - 2];
  if (variable && confirmed.slice(0, -1).some((t) => t.amount !== from.amount)) return null;
  if (100 * Math.abs(to.amount - from.amount) < from.amount) return null;
  return { from: from.amount, to: to.amount, on: istDate(to.occurred_at) };
}

// Every recurring payment, defined and detected, with what it costs (INS-09).
// Detected series have no stated price, so they're treated as variable.
export function recurringPayments(
  commitments: Commitment[],
  transactions: Transaction[],
  today: string,
): RecurringPayment[] {
  const payments = paymentsByCommitment(transactions);
  const defined: RecurringPayment[] = commitments
    .filter((c) => !c.paused_at && (!c.ends_on || c.ends_on >= today))
    .map((c) => {
      const paid = (payments.get(c.id) ?? []).filter((t) => !t.is_planned);
      const amount = paid.length ? paid[paid.length - 1].amount : c.amount;
      return {
        commitment: c,
        series: null,
        schedule: { unit: c.unit, every: c.every },
        amount,
        ...recurringCost(amount, c),
        priceChange: priceChange(paid, c.is_variable),
      };
    });
  const detected: RecurringPayment[] = detectRecurring(transactions, commitments, today, 2).map(
    (s) => ({
      commitment: null,
      series: s,
      schedule: { unit: s.unit, every: s.every },
      amount: s.amount,
      ...recurringCost(s.amount, s),
      priceChange: priceChange(s.payments, true),
    }),
  );
  return [...defined, ...detected].sort((a, b) => b.yearly - a.yearly);
}

