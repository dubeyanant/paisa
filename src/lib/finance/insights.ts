import { accountBalances, balanceSummary } from "./balances";
import {
  addDays,
  daysElapsed,
  istDate,
  istEndOf,
  periodLength,
  periodSoFar,
  recentPeriods,
  shiftBudgetMonth,
  typicalMonthPeriods,
  type Period,
} from "./dates";
import { committedIn, paymentsByCommitment, reservedIn } from "./recurring";
import { actualsIn, average, periodTotals, spendingBySubcategory, spendingWhere } from "./totals";
import type { Account, Commitment, Transaction } from "./types";

// The native insights (BRD §9, FR-9) that work from monthly totals. Recurring
// payments are in detection.ts (INS-09) and recurring.ts (INS-10), credit
// cards in cards.ts (INS-11), tags in tags.ts (INS-13), budget adherence in
// budget.ts (INS-17) and top alerts in alerts.ts (INS-19).
//
// Each returns figures only; headlines and charts are the screens' job.
// Amounts are paise, and `today` is an IST date.
//
// "Min data" in the catalogue counts budget months of history including the
// current one, so an insight that needs 3 months shows once there are 2
// complete months before this one. Until then it returns { ready: false } with
// the months still to go, for the "available after N months" state (FR-9 AC2).

export type Ready<T> = ({ ready: true } & T) | { ready: false; monthsToGo: number };

// The IST date of the earliest confirmed transaction, or null if there's none.
export function firstDateOf(transactions: Transaction[]): string | null {
  let first: string | null = null;
  for (const t of transactions) {
    if (t.is_planned || t.kind === "adjustment") continue;
    const date = istDate(t.occurred_at);
    if (first === null || date < first) first = date;
  }
  return first;
}

// Budget months of history up to and including `current`, counting at most `cap`.
export function monthsOfHistory(current: Period, firstDate: string | null, cap: number): number {
  if (!firstDate || firstDate >= current.end) return 0;
  let months = 1;
  while (months < cap && shiftBudgetMonth(current, -months).end > firstDate) months++;
  return months;
}

function needs<T extends object>(
  months: number,
  current: Period,
  firstDate: string | null,
  value: () => T,
): Ready<T> {
  const have = monthsOfHistory(current, firstDate, months);
  return have >= months ? { ready: true, ...value() } : { ready: false, monthsToGo: months - have };
}

// Spending per category in the period, refunds netted off (BR-6).
export function spendingByCategory(
  transactions: Transaction[],
  period: Period,
  categoryOf: Map<string, string>,
): Map<string, number> {
  const byCategory = new Map<string, number>();
  for (const [subcategory, amount] of spendingBySubcategory(transactions, period)) {
    const category = categoryOf.get(subcategory)!;
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
  }
  return byCategory;
}

// INS-01 Committed vs free money --------------------------------------------------

export type CommittedVsFree = {
  income: number;
  // Commitments due this budget month, paid or not.
  committed: number;
  // income − committed.
  free: number;
  // Spending so far that isn't a commitment payment.
  discretionary: number;
  // Planned one-off expenses later this month (BR-7).
  planned: number;
  // free − discretionary − planned: what can still be spent freely, the Home
  // screen's headline figure (FR-8 AC1).
  freeLeft: number;
  // Unpaid commitments and planned entries up to the end of the month (FR-6 AC2).
  reserved: number;
};

export function committedVsFree(
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  commitments: Commitment[],
  current: Period,
  today: string,
): CommittedVsFree {
  const income = periodTotals(transactions, accountsById, current).income;
  const committed = committedIn(commitments, paymentsByCommitment(transactions), current);
  const discretionary = spendingWhere(transactions, current, (t) => !t.recurring_id);
  let planned = 0;
  for (const t of transactions) {
    if (!t.is_planned || t.kind !== "expense" || t.recurring_id) continue;
    const date = istDate(t.occurred_at);
    if (date >= current.start && date < current.end) planned += t.amount;
  }
  const free = income - committed;
  return {
    income,
    committed,
    free,
    discretionary,
    planned,
    freeLeft: free - discretionary - planned,
    reserved: reservedIn(commitments, transactions, current, today),
  };
}

// INS-02 Savings rate -------------------------------------------------------------

export type SavingsMonth = {
  period: Period;
  income: number;
  spending: number;
  // income − spending.
  saved: number;
  // saved ÷ income (BR-9), or null without income.
  rate: number | null;
  // Moved into savings accounts (BR-9).
  invested: number;
};

// The last `months` budget months, oldest first, this one last.
export function savingsTrend(
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  current: Period,
  months = 6,
): SavingsMonth[] {
  return recentPeriods(current, months).map((period) => {
    const { income, spending, invested } = periodTotals(transactions, accountsById, period);
    const saved = income - spending;
    return { period, income, spending, saved, rate: income > 0 ? saved / income : null, invested };
  });
}

// INS-03 Emergency fund coverage --------------------------------------------------

export type EmergencyFund = {
  balance: number;
  // Average monthly spending over the last 3 complete months (BR-10).
  monthlySpending: number;
  // balance ÷ monthlySpending, or null when nothing was spent.
  months: number | null;
};

// Needs one complete month to average over. A screen that loads only recent
// transactions passes the balances from the database (TD-15).
export function emergencyFundCoverage(
  transactions: Transaction[],
  accounts: Account[],
  current: Period,
  firstDate: string | null,
  balances?: Map<string, number>,
): Ready<EmergencyFund> {
  return needs(2, current, firstDate, () => {
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const known = balances ?? accountBalances(accounts, transactions);
    const balance = accounts
      .filter((a) => a.is_emergency_fund)
      .reduce((sum, a) => sum + (known.get(a.id) ?? 0), 0);
    const monthlySpending = average(
      typicalMonthPeriods(current, firstDate).map(
        (p) => periodTotals(transactions, accountsById, p).spending,
      ),
    )!;
    return { balance, monthlySpending, months: monthlySpending > 0 ? balance / monthlySpending : null };
  });
}

// INS-04 Month-to-date pace -------------------------------------------------------

export type Pace = {
  spent: number;
  // The typical month (BR-10), and the part of it expected by today.
  typical: number;
  expected: number;
  // spent ÷ typical ("Food is at 65% of a usual month"), or null if typical is 0.
  shareOfTypical: number | null;
  // More than 20% ahead of the expected spend.
  runningHot: boolean;
};

function pace(spent: number, typical: number, elapsed: number, length: number): Pace {
  const expected = Math.round((typical * elapsed) / length);
  return {
    spent,
    typical,
    expected,
    shareOfTypical: typical > 0 ? spent / typical : null,
    runningHot: expected > 0 && 5 * spent > 6 * expected,
  };
}

// For total spending and each category. The typical month is prorated by the
// share of the budget month gone by.
export function monthToDatePace(
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  categoryOf: Map<string, string>,
  current: Period,
  today: string,
  firstDate: string | null,
): Ready<{ day: number; total: Pace; byCategory: Map<string, Pace> }> {
  return needs(3, current, firstDate, () => {
    const periods = typicalMonthPeriods(current, firstDate);
    const elapsed = daysElapsed(current, today);
    const length = periodLength(current);
    const upToToday = periodSoFar(current, today);

    const total = pace(
      periodTotals(transactions, accountsById, upToToday).spending,
      average(periods.map((p) => periodTotals(transactions, accountsById, p).spending))!,
      elapsed,
      length,
    );

    const months = periods.map((p) => spendingByCategory(transactions, p, categoryOf));
    const spent = spendingByCategory(transactions, upToToday, categoryOf);
    const categories = new Set([...spent.keys(), ...months.flatMap((m) => [...m.keys()])]);
    const byCategory = new Map<string, Pace>();
    for (const category of categories) {
      const typical = average(months.map((m) => m.get(category) ?? 0))!;
      byCategory.set(category, pace(spent.get(category) ?? 0, typical, elapsed, length));
    }
    return { day: elapsed, total, byCategory };
  });
}

// INS-05 Category trends ----------------------------------------------------------

export type CategoryTrend = {
  thisMonth: number;
  lastMonth: number;
  typical: number;
  // thisMonth ÷ typical, or null if typical is 0.
  multiple: number | null;
  // At least 1.5× the typical month.
  flagged: boolean;
  // The last 6 months, oldest first, this one last.
  history: number[];
};

export function categoryTrends(
  transactions: Transaction[],
  categoryOf: Map<string, string>,
  current: Period,
  firstDate: string | null,
): Ready<{ byCategory: Map<string, CategoryTrend> }> {
  return needs(2, current, firstDate, () => {
    const months = recentPeriods(current, 6).map((p) => spendingByCategory(transactions, p, categoryOf));
    const typicalMonths = typicalMonthPeriods(current, firstDate).map((p) =>
      spendingByCategory(transactions, p, categoryOf),
    );
    const categories = new Set(months.flatMap((m) => [...m.keys()]));

    const byCategory = new Map<string, CategoryTrend>();
    for (const category of categories) {
      const history = months.map((m) => m.get(category) ?? 0);
      const thisMonth = history[history.length - 1];
      const typical = average(typicalMonths.map((m) => m.get(category) ?? 0))!;
      byCategory.set(category, {
        thisMonth,
        lastMonth: history[history.length - 2],
        typical,
        multiple: typical > 0 ? thisMonth / typical : null,
        flagged: typical > 0 && 2 * thisMonth >= 3 * typical,
        history,
      });
    }
    return { byCategory };
  });
}

// INS-06 Small-spend leak ---------------------------------------------------------

export type SmallSpend = {
  subcategoryId: string;
  count: number;
  total: number;
  // total × 12 ("about ₹28,800 a year").
  yearly: number;
};

// Expenses under the threshold (settings.small_spend_threshold, ₹200 by
// default) by subcategory, biggest first. The screen shows the top 3.
export function smallSpendLeak(
  transactions: Transaction[],
  period: Period,
  threshold: number,
): SmallSpend[] {
  const bySubcategory = new Map<string, SmallSpend>();
  for (const t of actualsIn(transactions, period)) {
    if (t.kind !== "expense" || t.amount >= threshold) continue;
    const entry = bySubcategory.get(t.subcategory_id!) ?? {
      subcategoryId: t.subcategory_id!,
      count: 0,
      total: 0,
      yearly: 0,
    };
    entry.count += 1;
    entry.total += t.amount;
    entry.yearly = entry.total * 12;
    bySubcategory.set(t.subcategory_id!, entry);
  }
  return [...bySubcategory.values()].sort((a, b) => b.total - a.total);
}

// INS-07 Healthy vs junk food -----------------------------------------------------

export type FoodBalance = {
  period: Period;
  healthy: number;
  junk: number;
  // Rupees on healthy food per rupee on junk, or null with no junk.
  ratio: number | null;
};

export function healthyVsJunk(
  transactions: Transaction[],
  healthy: Set<string>,
  junk: Set<string>,
  current: Period,
  months = 6,
): FoodBalance[] {
  return recentPeriods(current, months).map((period) => {
    const h = spendingWhere(transactions, period, (t) => healthy.has(t.subcategory_id!));
    const j = spendingWhere(transactions, period, (t) => junk.has(t.subcategory_id!));
    return { period, healthy: h, junk: j, ratio: j > 0 ? h / j : null };
  });
}

// INS-08 Tracking accuracy --------------------------------------------------------

export type TrackingMonth = {
  period: Period;
  lostTrack: number;
  spending: number;
  // lostTrack ÷ spending, or null when nothing was spent.
  share: number | null;
};

export function trackingAccuracy(
  transactions: Transaction[],
  accountsById: Map<string, Account>,
  lostTrackId: string,
  current: Period,
  months = 6,
): TrackingMonth[] {
  return recentPeriods(current, months).map((period) => {
    const lostTrack = spendingWhere(transactions, period, (t) => t.subcategory_id === lostTrackId);
    const spending = periodTotals(transactions, accountsById, period).spending;
    return { period, lostTrack, spending, share: spending > 0 ? lostTrack / spending : null };
  });
}

// INS-12 Payday effect ------------------------------------------------------------

export type PaydayEffect = {
  // Average daily spending in the 7 days from payday, and on the other days.
  afterPayday: number;
  otherDays: number;
  // afterPayday ÷ otherDays, or null if nothing was spent on the other days.
  multiple: number | null;
  // Complete months with a salary in them.
  months: number;
};

// Over the last 3 complete budget months. Commitment payments aren't counted:
// rent paid on payday would make every payday look expensive.
export function paydayEffect(
  transactions: Transaction[],
  salary: Set<string>,
  current: Period,
  firstDate: string | null,
): Ready<PaydayEffect> {
  return needs(3, current, firstDate, () => {
    const discretionary = (t: Transaction) => !t.recurring_id;
    let after = 0;
    let afterDays = 0;
    let other = 0;
    let otherDays = 0;
    let months = 0;
    for (const period of typicalMonthPeriods(current, firstDate)) {
      const payday = actualsIn(transactions, period)
        .filter((t) => t.kind === "income" && salary.has(t.subcategory_id!))
        .map((t) => istDate(t.occurred_at))
        .sort()[0];
      if (!payday) continue;
      months += 1;
      const week = periodSoFar({ start: payday, end: period.end }, addDays(payday, 6));
      const weekSpend = spendingWhere(transactions, week, discretionary);
      after += weekSpend;
      afterDays += periodLength(week);
      other += spendingWhere(transactions, period, discretionary) - weekSpend;
      otherDays += periodLength(period) - periodLength(week);
    }
    const afterPayday = afterDays > 0 ? Math.round(after / afterDays) : 0;
    const otherDaily = otherDays > 0 ? Math.round(other / otherDays) : 0;
    return {
      afterPayday,
      otherDays: otherDaily,
      multiple: otherDaily > 0 ? afterPayday / otherDaily : null,
      months,
    };
  });
}

// INS-15 Family and giving --------------------------------------------------------

export type Giving = {
  // By subcategory: this calendar year so far, and this budget month.
  year: Map<string, number>;
  month: Map<string, number>;
  yearTotal: number;
  monthTotal: number;
};

export function familyAndGiving(
  transactions: Transaction[],
  categoryOf: Map<string, string>,
  categoryId: string,
  current: Period,
  today: string,
): Giving {
  const inCategory = (period: Period) => {
    const bySubcategory = new Map<string, number>();
    for (const [subcategory, amount] of spendingBySubcategory(transactions, period)) {
      if (categoryOf.get(subcategory) === categoryId) bySubcategory.set(subcategory, amount);
    }
    return bySubcategory;
  };
  const total = (m: Map<string, number>) => [...m.values()].reduce((sum, v) => sum + v, 0);
  const year = inCategory({ start: `${today.slice(0, 4)}-01-01`, end: addDays(today, 1) });
  const month = inCategory(current);
  return { year, month, yearTotal: total(year), monthTotal: total(month) };
}

// INS-18 Net position -------------------------------------------------------------

export type NetPositionMonth = { period: Period; netPosition: number };

// Net position at the end of each of the last `months` budget months, oldest
// first, this one as of today.
export function netPositionTrend(
  accounts: Account[],
  transactions: Transaction[],
  current: Period,
  today: string,
  months = 6,
): NetPositionMonth[] {
  return recentPeriods(current, months).map((period, i) => {
    const last = i === months - 1 ? today : addDays(period.end, -1);
    const balances = accountBalances(accounts, transactions, istEndOf(last));
    return { period, netPosition: balanceSummary(accounts, balances).netPosition };
  });
}
