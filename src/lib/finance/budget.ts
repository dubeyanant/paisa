import type { Period } from "./dates";
import { assertPaise } from "./money";
import { actualsIn, savingsFlow } from "./totals";
import type { Account, BudgetBucket, Transaction } from "./types";

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
