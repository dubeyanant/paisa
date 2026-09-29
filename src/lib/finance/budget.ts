import { daysElapsed, periodLength, recentPeriods, type Period } from "./dates";
import { everyday } from "./insights";
import { stillToPay } from "./recurring";
import { assertPaise } from "./money";
import { actualsIn, periodTotals, savingsFlow } from "./totals";
import type { Account, BudgetBucket, Commitment, Transaction } from "./types";

const FULL_SHARE_BP = 10000; // 100%

// Why a rule's buckets can't be saved, or null if they can (FR-7).
export function bucketProblem(buckets: Pick<BudgetBucket, "name" | "share_bp">[]): string | null {
  if (buckets.length < 2 || buckets.length > 6) {
    return `A rule needs 2 to 6 buckets. This one has ${buckets.length}.`;
  }
  const empty = buckets.find((b) => b.name.trim() === "");
  if (empty) return "Every bucket needs a name.";
  if (buckets.some((b) => !Number.isInteger(b.share_bp) || b.share_bp <= 0)) {
    return "Every bucket needs a share above 0%.";
  }
  const total = buckets.reduce((sum, b) => sum + b.share_bp, 0);
  if (total !== FULL_SHARE_BP) {
    return `The shares add up to ${formatShare(total)}. They must add up to 100%.`;
  }
  return null;
}

function formatShare(bp: number) {
  return `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

// The amount a rule divides up (FR-7): the month's actual income, or a fixed amount.
export function budgetBase(
  rule: { base: "income" | "fixed"; fixed_base: number | null },
  income: number,
): number {
  return rule.base === "fixed" ? (rule.fixed_base ?? 0) : income;
}

// Splits the base between buckets by share. Targets are exact to the paisa and
// always add up to the base: leftover paise from rounding go to the buckets
// with the largest remainders.
export function bucketTargets(base: number, buckets: BudgetBucket[]): Map<string, number> {
  assertPaise(base);
  const shares = buckets.map((b) => {
    const exact = base * b.share_bp;
    return { id: b.id, paise: Math.floor(exact / FULL_SHARE_BP), remainder: exact % FULL_SHARE_BP };
  });
  let leftover = base - shares.reduce((sum, s) => sum + s.paise, 0);
  for (const s of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    s.paise += 1;
    leftover -= 1;
  }
  return new Map(shares.map((s) => [s.id, s.paise]));
}

export type BucketActuals = {
  byBucket: Map<string, number>;
  // Spending in subcategories the rule hasn't assigned to a bucket yet.
  unassigned: number;
};

// What has gone into each bucket in the period (FR-7):
// - expenses minus refunds, by the transaction's override if it points at one
//   of this rule's buckets, otherwise by its subcategory's assignment
// - net transfers into savings accounts, in the bucket that holds savings
export function bucketActuals(
  transactions: Transaction[],
  rule: { buckets: BudgetBucket[]; assignments: Map<string, string> },
  accountsById: Map<string, Account>,
  period: Period,
): BucketActuals {
  const byBucket = new Map(rule.buckets.map((b) => [b.id, 0]));
  const savingsBucket = rule.buckets.find((b) => b.holds_savings)?.id;
  let unassigned = 0;

  for (const t of actualsIn(transactions, period)) {
    assertPaise(t.amount);
    if (t.kind === "expense" || t.kind === "refund") {
      const signed = t.kind === "expense" ? t.amount : -t.amount;
      const override =
        t.bucket_override_id && byBucket.has(t.bucket_override_id) ? t.bucket_override_id : null;
      const bucket = override ?? rule.assignments.get(t.subcategory_id!);
      if (bucket && byBucket.has(bucket)) byBucket.set(bucket, byBucket.get(bucket)! + signed);
      else unassigned += signed;
    } else if (t.kind === "transfer" && savingsBucket) {
      const flow = savingsFlow(t, accountsById);
      byBucket.set(savingsBucket, byBucket.get(savingsBucket)! + flow);
    }
  }
  return { byBucket, unassigned };
}

// INS-17 Budget rule adherence ------------------------------------------------

export type BudgetRule = {
  base: "income" | "fixed";
  fixed_base: number | null;
  buckets: BudgetBucket[];
  // Subcategory → bucket.
  assignments: Map<string, string>;
};

export type BucketStatus = "on_track" | "at_risk" | "over";

export type BucketAdherence = {
  bucket: BudgetBucket;
  target: number;
  actual: number;
  // target − actual. For the savings bucket, what's still to save.
  remaining: number;
  // actual ÷ base ("Wants at 36% vs 30% target"), or null with no base.
  shareOfBase: number | null;
  // A spending bucket is over past its target, and at risk while the month is
  // heading past it. The savings bucket is at risk while it's heading short of
  // its target, and never over. Where the month is heading: planned payments
  // in full, paid or not, and everyday spending at its pace so far.
  status: BucketStatus;
  // Planned payments in this bucket still to pay this month, and where the
  // month is heading (what status goes by).
  plannedLeft: number;
  projected: number;
  // Complete months off target in a row just before this one, plus this one if
  // it's already over: "3rd month over".
  streak: number;
  // Complete months, oldest first.
  history: { period: Period; target: number; actual: number; onTarget: boolean }[];
};

function onTarget(bucket: BudgetBucket, actual: number, target: number): boolean {
  return bucket.holds_savings ? actual >= target : actual <= target;
}

// Planned payments this month: `upcoming` are the ones still to pay, as
// transactions (stillToPay()), and `isPlanned` picks out the ones already paid.
// Without them, everything counts as everyday spending.
export type PlannedPayments = { upcoming: Transaction[]; isPlanned: (t: Transaction) => boolean };

// The planned payments of the budget month, for budgetAdherence(). `transactions`
// must include every payment linked to a commitment and every planned entry.
export function plannedPayments(
  transactions: Transaction[],
  commitments: Commitment[],
  current: Period,
  today: string,
): PlannedPayments {
  const everydayIds = new Set(everyday(transactions, commitments, today).map((t) => t.id));
  return {
    upcoming: stillToPay(commitments, transactions, current, today),
    isPlanned: (t) => !everydayIds.has(t.id),
  };
}

export function budgetAdherence(
  transactions: Transaction[],
  rule: BudgetRule,
  accountsById: Map<string, Account>,
  current: Period,
  today: string,
  historyMonths = 6,
  planned?: PlannedPayments,
): { base: number; buckets: BucketAdherence[]; unassigned: number } {
  const month = (period: Period) => {
    const base = budgetBase(rule, periodTotals(transactions, accountsById, period).income);
    return {
      period,
      base,
      targets: bucketTargets(base, rule.buckets),
      actuals: bucketActuals(transactions, rule, accountsById, period),
    };
  };
  const now = month(current);
  const past = recentPeriods(current, historyMonths + 1).slice(0, -1).map(month);
  const elapsed = daysElapsed(current, today);
  const length = periodLength(current);
  const plannedPaid = planned
    ? bucketActuals(transactions.filter(planned.isPlanned), rule, accountsById, current).byBucket
    : new Map<string, number>();
  const plannedLeft = planned
    ? bucketActuals(planned.upcoming, rule, accountsById, current).byBucket
    : new Map<string, number>();

  const buckets = rule.buckets.map((bucket): BucketAdherence => {
    const target = now.targets.get(bucket.id)!;
    const actual = now.actuals.byBucket.get(bucket.id)!;
    const paid = plannedPaid.get(bucket.id) ?? 0;
    const left = plannedLeft.get(bucket.id) ?? 0;
    const projected = paid + left + Math.round(((actual - paid) * length) / Math.max(elapsed, 1));
    const status: BucketStatus = bucket.holds_savings
      ? projected >= target
        ? "on_track"
        : "at_risk"
      : actual > target
        ? "over"
        : projected > target
          ? "at_risk"
          : "on_track";

    const history = past.map((m) => {
      const t = m.targets.get(bucket.id)!;
      const a = m.actuals.byBucket.get(bucket.id)!;
      return { period: m.period, target: t, actual: a, onTarget: onTarget(bucket, a, t) };
    });
    let streak = status === "over" ? 1 : 0;
    for (let i = history.length - 1; i >= 0 && !history[i].onTarget; i--) streak++;

    return {
      bucket,
      target,
      actual,
      remaining: target - actual,
      shareOfBase: now.base > 0 ? actual / now.base : null,
      status,
      plannedLeft: left,
      projected,
      streak,
      history,
    };
  });
  return { base: now.base, buckets, unassigned: now.actuals.unassigned };
}
