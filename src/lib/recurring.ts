// Logic behind the Recurring screens (FR-6): checking a commitment before it's
// saved, describing its schedule, and sorting what's due into "due now" and
// "upcoming". The due dates themselves come from src/lib/finance/recurring.ts.

import { ordinal } from "@/lib/accounts";
import { isDate, parseName } from "@/lib/categories";
import { addDays, istDate } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import { dues, nthDueDate, paymentsByCommitment } from "@/lib/finance/recurring";
import type { Commitment, Transaction } from "@/lib/finance/types";

export type Unit = Commitment["unit"];

export type CommitmentInput = {
  name: string;
  kind: "expense" | "transfer";
  // Rupees, as typed.
  amount: string;
  is_variable: boolean;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  unit: Unit;
  every: number;
  first_due_on: string;
  // "" for no end.
  ends_on: string;
};

export type CommitmentRow = {
  name: string;
  kind: "expense" | "transfer";
  amount: number;
  is_variable: boolean;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  unit: Unit;
  every: number;
  first_due_on: string;
  ends_on: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Turns what was entered into a row to save, as the database requires.
export function parseCommitment(
  input: CommitmentInput,
): { ok: true; row: CommitmentRow } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });

  const name = parseName(input.name, "commitment");
  if (!name.ok) return name;
  if (input.kind !== "expense" && input.kind !== "transfer") return fail("Choose what kind of payment this is.");
  const amount = parseRupees(String(input.amount ?? ""));
  if (!amount) return fail("Enter the amount you expect to pay.");

  if (!UUID.test(input.account_id ?? "")) return fail("Choose the account it's paid from.");
  let to_account_id: string | null = null;
  let subcategory_id: string | null = null;
  if (input.kind === "transfer") {
    if (!UUID.test(input.to_account_id ?? "")) return fail("Choose the account the money goes to.");
    if (input.to_account_id === input.account_id) return fail("Choose two different accounts.");
    to_account_id = input.to_account_id;
  } else {
    if (!UUID.test(input.subcategory_id ?? "")) return fail("Choose a category.");
    subcategory_id = input.subcategory_id;
  }

  if (!["week", "month", "year"].includes(input.unit)) return fail("Choose how often it repeats.");
  const every = Number(input.every);
  if (!Number.isInteger(every) || every < 1 || every > 52) return fail("Repeat every 1 to 52 weeks, months or years.");

  if (!isDate(String(input.first_due_on ?? ""))) return fail("Enter the date it's due.");
  const endsOn = String(input.ends_on ?? "").trim();
  if (endsOn && !isDate(endsOn)) return fail("Enter a real end date, or leave it empty.");
  if (endsOn && endsOn < input.first_due_on) return fail("The end date is before the first due date.");

  return {
    ok: true,
    row: {
      name: name.name,
      kind: input.kind,
      amount,
      is_variable: Boolean(input.is_variable),
      account_id: input.account_id,
      to_account_id,
      subcategory_id,
      unit: input.unit,
      every,
      first_due_on: input.first_due_on,
      ends_on: endsOn || null,
    },
  };
}

// Whether `date` is one of the commitment's scheduled due dates, skipped or not.
export function isScheduledOn(c: Pick<Commitment, "unit" | "every" | "first_due_on">, date: string): boolean {
  for (let n = 0; ; n++) {
    const due = nthDueDate(c, n);
    if (due === date) return true;
    if (due > date) return false;
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Monthly on the 5th", "Every 3 months on the 15th", "Weekly on Tuesday",
// "Yearly on 12 Mar". A month without the day (the 31st) uses its last day.
export function describeSchedule(c: Pick<Commitment, "unit" | "every" | "first_due_on">): string {
  const [year, month, day] = c.first_due_on.split("-").map(Number);
  const on =
    c.unit === "week"
      ? `on ${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`
      : c.unit === "month"
        ? `on the ${ordinal(day)}`
        : `on ${day} ${MONTHS[month - 1]}`;
  if (c.every === 1) return `${{ week: "Weekly", month: "Monthly", year: "Yearly" }[c.unit]} ${on}`;
  return `Every ${c.every} ${c.unit}s ${on}`;
}

export type DueNow =
  | {
      type: "due";
      commitment: Commitment;
      // The earliest unpaid due date. A payment covers the earliest one first,
      // so that's the one to confirm or skip.
      due_on: string;
      // Further unpaid due dates up to today.
      more: string[];
    }
  | { type: "planned"; entry: Transaction };

export type UpcomingEntry = {
  date: string;
  amount: number;
  commitment: Commitment | null;
  entry: Transaction | null;
};

export type RecurringOverview = {
  // To confirm or skip now: unpaid due dates up to today, and planned entries
  // whose time has come (BR-7). Oldest first.
  dueNow: DueNow[];
  // Due after today, within `days` days: unpaid due dates and planned
  // outgoing entries (FR-6). Soonest first.
  upcoming: UpcomingEntry[];
  upcomingTotal: number;
};

// `transactions` are every payment linked to a commitment and every planned
// entry; `now` decides which planned entries are due.
export function recurringOverview(
  commitments: Commitment[],
  transactions: Transaction[],
  now: Date,
  days = 30,
): RecurringOverview {
  const today = istDate(now);
  const until = addDays(today, days + 1);
  const payments = paymentsByCommitment(transactions);
  const unpaid = dues(commitments, payments, until).filter((d) => !d.payment);

  const dueNow: { date: string; item: DueNow }[] = [];
  const firstDue = new Map<string, DueNow & { type: "due" }>();
  const upcoming: UpcomingEntry[] = [];
  for (const d of unpaid) {
    if (d.due_on > today) {
      upcoming.push({ date: d.due_on, amount: d.commitment.amount, commitment: d.commitment, entry: null });
      continue;
    }
    const first = firstDue.get(d.commitment.id);
    if (first) {
      first.more.push(d.due_on);
      continue;
    }
    const item = { type: "due" as const, commitment: d.commitment, due_on: d.due_on, more: [] };
    firstDue.set(d.commitment.id, item);
    dueNow.push({ date: d.due_on, item });
  }

  const byId = new Map(commitments.map((c) => [c.id, c]));
  for (const t of transactions) {
    if (!t.is_planned || (t.kind !== "expense" && t.kind !== "transfer")) continue;
    const date = istDate(t.occurred_at);
    if (Date.parse(t.occurred_at) <= now.getTime()) {
      dueNow.push({ date, item: { type: "planned", entry: t } });
    } else if (date < until) {
      const commitment = t.recurring_id ? (byId.get(t.recurring_id) ?? null) : null;
      upcoming.push({ date, amount: t.amount, commitment, entry: t });
    }
  }

  dueNow.sort((a, b) => a.date.localeCompare(b.date));
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return {
    dueNow: dueNow.map((d) => d.item),
    upcoming,
    upcomingTotal: upcoming.reduce((sum, u) => sum + u.amount, 0),
  };
}

// When a confirmed due date's payment is dated: now if it's due today, else
// noon IST on the due date, so a bill paid late last month still counts in
// the month it was due.
export function confirmedAt(dueOn: string, now: Date): Date {
  if (dueOn >= istDate(now)) return now;
  return new Date(`${dueOn}T12:00:00+05:30`);
}

// A due date in a sentence: "today", "yesterday", "tomorrow", "5 Sep", or
// "5 Sep 2025" in another year.
export function dayInSentence(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  if (date === addDays(today, 1)) return "tomorrow";
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}${date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${year}`}`;
}
