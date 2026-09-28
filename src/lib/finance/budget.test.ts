import { describe, expect, test } from "bun:test";
import { bucketActuals, bucketProblem, bucketTargets, budgetBase } from "./budget";
import { budgetMonthOf } from "./dates";
import { account, byId, tx } from "./fixtures";
import type { BudgetBucket } from "./types";

const fiftyThirtyTwenty: BudgetBucket[] = [
  { id: "needs", name: "Needs", share_bp: 5000, holds_savings: false },
  { id: "wants", name: "Wants", share_bp: 3000, holds_savings: false },
  { id: "savings", name: "Savings", share_bp: 2000, holds_savings: true },
];

describe("bucket targets", () => {
  test("50/30/20 of ₹60,001 is exact to the paisa (FR-7 AC1, UAT-6)", () => {
    expect(bucketTargets(6000100, fiftyThirtyTwenty)).toEqual(
      new Map([
        ["needs", 3000050],
        ["wants", 1800030],
        ["savings", 1200020],
      ]),
    );
  });

  test("always add up to the base, even when shares don't divide evenly", () => {
    const thirds: BudgetBucket[] = [
      { id: "a", name: "A", share_bp: 3333, holds_savings: false },
      { id: "b", name: "B", share_bp: 3333, holds_savings: false },
      { id: "c", name: "C", share_bp: 3334, holds_savings: false },
    ];
    for (const base of [1, 99, 100, 6000100, 1234567]) {
      const targets = [...bucketTargets(base, thirds).values()];
      expect(targets.reduce((a, b) => a + b, 0)).toBe(base);
    }
  });

  test("follow a custom rule (UAT-7)", () => {
    const custom: BudgetBucket[] = [
      { id: "needs", name: "Needs", share_bp: 5500, holds_savings: false },
      { id: "wants", name: "Wants", share_bp: 2500, holds_savings: false },
      { id: "savings", name: "Savings", share_bp: 2000, holds_savings: true },
    ];
    expect(bucketTargets(6000000, custom)).toEqual(
      new Map([
        ["needs", 3300000],
        ["wants", 1500000],
        ["savings", 1200000],
      ]),
    );
  });
});

describe("budget base", () => {
  test("is the month's income or a fixed amount (FR-7)", () => {
    expect(budgetBase({ base: "income", fixed_base: null }, 6000100)).toBe(6000100);
    expect(budgetBase({ base: "fixed", fixed_base: 6000000 }, 6000100)).toBe(6000000);
  });
});

describe("bucket rules", () => {
  test("shares must add up to 100% (FR-7 AC2)", () => {
    const shares = [2500, 2500, 2500, 2000].map((share_bp, i) => ({ name: `B${i}`, share_bp }));
    expect(bucketProblem(shares)).toBe("The shares add up to 95%. They must add up to 100%.");
  });

  test("need 2 to 6 named buckets", () => {
    expect(bucketProblem([{ name: "All", share_bp: 10000 }])).toMatch(/2 to 6/);
    expect(bucketProblem(Array.from({ length: 7 }, () => ({ name: "X", share_bp: 1000 })))).toMatch(
      /2 to 6/,
    );
    expect(bucketProblem([{ name: " ", share_bp: 5000 }, { name: "B", share_bp: 5000 }])).toMatch(
      /name/,
    );
  });

  test("accept a valid rule", () => {
    expect(bucketProblem(fiftyThirtyTwenty)).toBeNull();
  });
});

describe("bucket actuals", () => {
  const accounts = byId([account("bank", "bank"), account("mf", "savings"), account("fd", "savings")]);
  const rule = {
    buckets: fiftyThirtyTwenty,
    assignments: new Map([
      ["rickshaw", "needs"],
      ["family", "needs"],
      ["eating-out", "wants"],
      ["cab", "wants"],
    ]),
  };
  const sep = budgetMonthOf("2026-09-01");

  test("sort spending by each subcategory's bucket", () => {
    const transactions = [
      tx({ kind: "expense", amount: 12000, subcategory_id: "rickshaw" }),
      tx({ kind: "expense", amount: 800000, subcategory_id: "family" }), // BR-12
      tx({ kind: "expense", amount: 45000, subcategory_id: "eating-out" }),
      tx({ kind: "refund", amount: 5000, subcategory_id: "eating-out" }),
      tx({ kind: "expense", amount: 9900, subcategory_id: "new-thing" }),
    ];
    const { byBucket, unassigned } = bucketActuals(transactions, rule, accounts, sep);
    expect(byBucket).toEqual(
      new Map([
        ["needs", 812000],
        ["wants", 40000],
        ["savings", 0],
      ]),
    );
    expect(unassigned).toBe(9900);
  });

  test("an override moves exactly that transaction (FR-7 AC3)", () => {
    const cab = tx({ kind: "expense", amount: 35000, subcategory_id: "cab" });
    const before = bucketActuals([cab], rule, accounts, sep).byBucket;
    const after = bucketActuals([{ ...cab, bucket_override_id: "needs" }], rule, accounts, sep).byBucket;
    expect(after.get("needs")! - before.get("needs")!).toBe(35000);
    expect(before.get("wants")! - after.get("wants")!).toBe(35000);
  });

  test("an override from another rule is ignored", () => {
    const cab = tx({ kind: "expense", amount: 35000, subcategory_id: "cab", bucket_override_id: "old-rule-bucket" });
    expect(bucketActuals([cab], rule, accounts, sep).byBucket.get("wants")).toBe(35000);
  });

  test("savings transfers fill the savings bucket (FR-7 AC4, UAT-5)", () => {
    const transactions = [
      tx({ kind: "transfer", amount: 1000000, account_id: "bank", to_account_id: "mf" }),
      tx({ kind: "transfer", amount: 2500000, account_id: "bank", to_account_id: "fd" }),
    ];
    expect(bucketActuals(transactions, rule, accounts, sep).byBucket.get("savings")).toBe(3500000);
  });

  test("withdrawals from savings reduce the savings bucket", () => {
    const transactions = [
      tx({ kind: "transfer", amount: 1000000, account_id: "bank", to_account_id: "mf" }),
      tx({ kind: "transfer", amount: 300000, account_id: "mf", to_account_id: "bank" }),
    ];
    expect(bucketActuals(transactions, rule, accounts, sep).byBucket.get("savings")).toBe(700000);
  });
});
