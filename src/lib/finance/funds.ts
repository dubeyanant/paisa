import { budgetMonthOf, istDate, istStartOf, periodContains, type Period } from "./dates";
import { assertPaise } from "./money";
import type { Transaction } from "./types";

// Funds (TD-21): money kept in the bank for a goal or an ongoing purpose. A
// fund's balance is what went in (each budget month's amount, and money added
// or taken out by hand) minus what it paid for. The balance is held back from
// available to spend, and money counts in the fund's budget bucket when it
// goes in, not when it's spent.

export type Fund = {
  id: string;
  // A goal saves `target` over the months up to the one with ends_on, then
  // pays for one purchase. An ongoing fund saves monthly_amount every month,
  // up to `cap`, and pays for any number of spends.
  kind: "goal" | "ongoing";
  bucket_id: string | null;
  target: number | null;
  monthly_amount: number | null;
  cap: number | null;
  // A date in the first budget month of the current schedule.
  schedule_from: string;
  ends_on: string | null;
  closed_at: string | null;
};

// Money added (positive) or taken out (negative) by hand, or a past month's
// scheduled amount kept when the schedule changed (is_monthly).
export type FundMove = { fund_id: string; amount: number; occurred_at: string; is_monthly: boolean };

export type FundEvent =
  // A budget month's scheduled amount, going in on its first day.
  | { type: "monthly"; at: string; amount: number }
  | { type: "move"; at: string; amount: number; is_monthly: boolean }
  // What the fund covered of an expense (positive) or took back from a refund
  // (negative). The rest of the transaction counts as usual.
  | { type: "spend"; at: string; transaction: Transaction; covered: number }
  // What was left when the fund closed, freed again (negative).
  | { type: "release"; at: string; amount: number };

export type FundState = {
  fund: Fund;
  // Held now. Never below zero, since a fund only covers what it holds.
  balance: number;
  // When it closed: by hand, or at a goal's purchase. Null while open.
  closedAt: string | null;
  // This budget month's scheduled amount, 0 if there's none.
  thisMonth: number;
  // A goal's budget months still to save in, this one included.
  monthsLeft: number;
  // Oldest first.
  events: FundEvent[];
};

// Months are counted as year × 12 + month of the budget month's first day.
function monthIndex(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return year * 12 + month;
}

function ceilToRupee(paise: number, parts: number): number {
  return Math.ceil(paise / (parts * 100)) * 100;
}

// Everything that happened to one fund up to `now`, and where it stands.
// `spends` are the transactions linked to it; planned ones don't count.
export function fundState(
  fund: Fund,
  moves: FundMove[],
  spends: Transaction[],
  startDay: number,
  now: Date,
): FundState {
  const today = istDate(now);
  const nowMs = now.getTime();
  const current = budgetMonthOf(today, startDay);
  const last = fund.kind === "goal" && fund.ends_on ? budgetMonthOf(fund.ends_on, startDay) : null;

  // What happens, in order. At the same moment, money goes in before it's spent.
  type Item =
    | { at: string; rank: 0; type: "monthly"; period: Period }
    | { at: string; rank: 0; type: "move"; move: FundMove }
    | { at: string; rank: 1; type: "spend"; transaction: Transaction }
    | { at: string; rank: 2; type: "close" };
  const items: Item[] = [];
  for (let period = budgetMonthOf(fund.schedule_from, startDay); period.start <= today; ) {
    if (last && period.start > last.start) break;
    items.push({ at: istStartOf(period.start).toISOString(), rank: 0, type: "monthly", period });
    period = budgetMonthOf(period.end, startDay);
  }
  for (const move of moves) {
    if (move.fund_id === fund.id && Date.parse(move.occurred_at) <= nowMs) {
      items.push({ at: move.occurred_at, rank: 0, type: "move", move });
    }
  }
  for (const t of spends) {
    if (t.is_planned || Date.parse(t.occurred_at) > nowMs) continue;
    if (t.kind === "expense" || t.kind === "refund") items.push({ at: t.occurred_at, rank: 1, type: "spend", transaction: t });
  }
  if (fund.closed_at && Date.parse(fund.closed_at) <= nowMs) items.push({ at: fund.closed_at, rank: 2, type: "close" });
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.rank - b.rank);

  const events: FundEvent[] = [];
  let balance = 0;
  let closedAt: string | null = null;
  let thisMonth = 0;
  const close = (at: string) => {
    if (balance !== 0) events.push({ type: "release", at, amount: -balance });
    balance = 0;
    closedAt = at;
  };

  for (const item of items) {
    if (item.type === "spend") {
      const t = item.transaction;
      assertPaise(t.amount);
      // Once closed, a fund covers nothing: spends count as usual.
      let covered = 0;
      if (!closedAt) covered = t.kind === "expense" ? Math.min(t.amount, Math.max(balance, 0)) : -t.amount;
      balance -= covered;
      events.push({ type: "spend", at: item.at, transaction: t, covered });
      // A goal's purchase is its first expense.
      if (!closedAt && fund.kind === "goal" && t.kind === "expense") close(item.at);
      continue;
    }
    if (closedAt) continue;
    if (item.type === "close") {
      close(item.at);
    } else if (item.type === "move") {
      assertPaise(item.move.amount);
      balance += item.move.amount;
      events.push({ type: "move", at: item.at, amount: item.move.amount, is_monthly: item.move.is_monthly });
    } else {
      const amount = scheduledAmount(fund, balance, item.period, last);
      if (item.period.start === current.start) thisMonth = amount;
      if (amount > 0) {
        balance += amount;
        events.push({ type: "monthly", at: item.at, amount });
      }
    }
  }

  const monthsLeft =
    last && !closedAt ? Math.max(monthIndex(last.start) - monthIndex(current.start) + 1, 0) : 0;
  return { fund, balance: Math.max(balance, 0), closedAt, thisMonth, monthsLeft, events };
}

// What goes in at the start of `period`, given the balance just before.
function scheduledAmount(fund: Fund, balance: number, period: Period, last: Period | null): number {
  if (fund.kind === "goal") {
    const remaining = (fund.target ?? 0) - balance;
    if (remaining <= 0 || !last) return 0;
    const monthsLeft = monthIndex(last.start) - monthIndex(period.start) + 1;
    return Math.min(remaining, ceilToRupee(remaining, monthsLeft));
  }
  const monthly = fund.monthly_amount ?? 0;
  if (fund.cap === null) return monthly;
  return Math.max(Math.min(monthly, fund.cap - balance), 0);
}

// Every fund's state. `spends` may hold transactions of any fund.
export function fundStates(
  funds: Fund[],
  moves: FundMove[],
  spends: (Transaction & { fund_id?: string | null })[],
  startDay: number,
  now: Date,
): FundState[] {
  return funds.map((fund) =>
    fundState(
      fund,
      moves.filter((m) => m.fund_id === fund.id),
      spends.filter((t) => t.fund_id === fund.id),
      startDay,
      now,
    ),
  );
}

// What the fund held just before `moment`.
export function balanceBefore(state: FundState, moment: Date): number {
  let balance = 0;
  for (const e of state.events) {
    if (Date.parse(e.at) >= moment.getTime()) break;
    balance += e.type === "spend" ? -e.covered : e.amount;
  }
  return balance;
}

// Held back from available to spend.
export function heldInFunds(states: FundState[]): number {
  return states.reduce((sum, s) => sum + s.balance, 0);
}

// How funds change what the budget counts (TD-21): money going in (or freed)
// counts in the fund's bucket in its month, and the part of a spend a fund
// covered doesn't count again.
export type FundBudget = {
  // Money in, as expenses in the fund's bucket (refunds when it's freed).
  contributions: Transaction[];
  // Transaction id → paise the fund covered, signed like the event.
  covered: Map<string, number>;
};

export const NO_FUNDS: FundBudget = { contributions: [], covered: new Map() };

export function fundBudget(states: FundState[]): FundBudget {
  const contributions: Transaction[] = [];
  const covered = new Map<string, number>();
  for (const { fund, events } of states) {
    events.forEach((e, i) => {
      if (e.type === "spend") {
        if (e.covered !== 0) covered.set(e.transaction.id, e.covered);
        return;
      }
      contributions.push({
        id: `fund:${fund.id}:${i}`,
        kind: e.amount > 0 ? "expense" : "refund",
        occurred_at: e.at,
        amount: Math.abs(e.amount),
        account_id: "",
        to_account_id: null,
        subcategory_id: null,
        is_planned: false,
        bucket_override_id: fund.bucket_id,
      });
    });
  }
  return { contributions, covered };
}

export function isFundContribution(t: Transaction): boolean {
  return t.id.startsWith("fund:");
}

// The transactions with what funds covered taken off, and ones fully covered
// left out: for spending pace, which counts only spending as it happens.
export function withoutCovered(transactions: Transaction[], funds: FundBudget): Transaction[] {
  if (funds.covered.size === 0) return transactions;
  return transactions.flatMap((t) => {
    const covered = funds.covered.get(t.id);
    if (covered === undefined) return [t];
    const amount = t.amount - Math.abs(covered);
    return amount > 0 ? [{ ...t, amount }] : [];
  });
}

// The same, plus money going into funds: what the budget counts.
export function withFunds(transactions: Transaction[], funds: FundBudget): Transaction[] {
  return [...withoutCovered(transactions, funds), ...funds.contributions];
}

// Money that went into funds (or was freed) in the period.
export function fundContributionsIn(funds: FundBudget, period: Period): number {
  return funds.contributions
    .filter((t) => periodContains(period, t.occurred_at))
    .reduce((sum, t) => sum + (t.kind === "expense" ? t.amount : -t.amount), 0);
}

// The scheduled months before `current` that haven't been kept yet: kept as
// fund_moves before a schedule changes, so past months stay as they were.
export function finishedMonths(state: FundState, current: Period): { amount: number; occurred_at: string }[] {
  const start = istStartOf(current.start).getTime();
  return state.events.flatMap((e) =>
    e.type === "monthly" && Date.parse(e.at) < start ? [{ amount: e.amount, occurred_at: e.at }] : [],
  );
}
