import { describe, expect, test } from "bun:test";
import { budgetMonthOf } from "./dates";
import { account, at, byId, commitment, tx } from "./fixtures";
import {
  categoryTrends,
  committedVsFree,
  emergencyFundCoverage,
  familyAndGiving,
  firstDateOf,
  healthyVsJunk,
  monthToDatePace,
  monthsOfHistory,
  netPositionTrend,
  paydayEffect,
  savingsTrend,
  smallSpendLeak,
  trackingAccuracy,
} from "./insights";
import type { Transaction } from "./types";

const accountList = [account("bank", "bank", 10000000), account("ef", "savings"), account("card", "credit_card")];
accountList[1].is_emergency_fund = true;
const accounts = byId(accountList);
const sep = budgetMonthOf("2026-09-01");
const categoryOf = new Map([
  ["groceries", "food"],
  ["eating-out", "food"],
  ["healthy", "food"],
  ["junk", "food"],
  ["rickshaw", "transport"],
  ["rent", "home"],
  ["family", "giving"],
  ["friends", "giving"],
  ["lost", "personal"],
]);

const spend = (subcategory_id: string, amount: number, date: string, fields: Partial<Transaction> = {}) =>
  tx({ kind: "expense", amount, subcategory_id, occurred_at: at(date), ...fields });
const salary = (date: string, amount = 6000000) =>
  tx({ kind: "income", amount, subcategory_id: "salary", occurred_at: at(date) });

describe("history", () => {
  test("months of history include the current one", () => {
    expect(monthsOfHistory(sep, null, 3)).toBe(0);
    expect(monthsOfHistory(sep, "2026-09-15", 3)).toBe(1);
    expect(monthsOfHistory(sep, "2026-08-31", 3)).toBe(2);
    expect(monthsOfHistory(sep, "2020-01-01", 3)).toBe(3);
  });

  test("the first date ignores planned entries and adjustments", () => {
    expect(
      firstDateOf([
        spend("rent", 100, "2026-05-01", { is_planned: true }),
        tx({ kind: "adjustment", amount: 5, occurred_at: at("2026-04-01") }),
        spend("rent", 100, "2026-06-01"),
      ]),
    ).toBe("2026-06-01");
  });
});

describe("INS-01 committed vs free money", () => {
  const commitments = [
    ["rent", 1500000],
    ["furniture", 300000],
    ["house-help", 400000],
    ["family", 800000],
    ["gym", 250000],
    ["insurance", 150000],
    ["streaming", 19900],
    ["electricity", 120000],
  ].map(([id, amount]) => commitment({ id: id as string, amount: amount as number, first_due_on: "2026-09-05" }));

  test("₹35,399 committed and ₹24,601 free on a ₹60,000 salary (UAT-3)", () => {
    const result = committedVsFree([salary("2026-09-01")], accounts, commitments, sep, "2026-09-01");
    expect(result).toMatchObject({ income: 6000000, committed: 3539900, free: 2460100, reserved: 3539900 });
  });

  test("free money left takes off discretionary spending and planned one-offs", () => {
    const transactions = [
      salary("2026-09-01"),
      spend("rent", 1500000, "2026-09-05", { recurring_id: "rent" }),
      spend("eating-out", 1000000, "2026-09-06"),
      spend("groceries", 260100, "2026-09-25", { is_planned: true }),
    ];
    const result = committedVsFree(transactions, accounts, commitments, sep, "2026-09-10");
    expect(result).toMatchObject({
      committed: 3539900,
      discretionary: 1000000,
      planned: 260100,
      freeLeft: 1200000,
      reserved: 2039900 + 260100,
    });
  });
});

describe("INS-02 savings rate", () => {
  test("this month and the months before", () => {
    const transactions = [
      salary("2026-08-01"),
      spend("rent", 4800000, "2026-08-02"),
      salary("2026-09-01"),
      spend("rent", 4500000, "2026-09-02"),
      tx({ kind: "transfer", amount: 1000000, to_account_id: "ef", occurred_at: at("2026-09-03") }),
    ];
    const trend = savingsTrend(transactions, accounts, sep, 2);
    expect(trend.map((m) => [m.saved, m.rate, m.invested])).toEqual([
      [1200000, 0.2, 0],
      [1500000, 0.25, 1000000],
    ]);
  });
});

describe("INS-03 emergency fund coverage", () => {
  test("balance ÷ average monthly spending over the last 3 complete months", () => {
    const transactions = [
      tx({ kind: "transfer", amount: 10000000, to_account_id: "ef", occurred_at: at("2026-05-01") }),
      spend("rent", 4000000, "2026-06-10"),
      spend("rent", 4000000, "2026-07-10"),
      spend("rent", 4000000, "2026-08-10"),
      spend("rent", 9000000, "2026-09-10"), // this month doesn't count
    ];
    const result = emergencyFundCoverage(transactions, accountList, sep, firstDateOf(transactions));
    expect(result).toEqual({ ready: true, balance: 10000000, monthlySpending: 4000000, months: 2.5 });
    const given = emergencyFundCoverage(transactions, accountList, sep, firstDateOf(transactions), new Map([["ef", 2000000]]));
    expect(given).toEqual({ ready: true, balance: 2000000, monthlySpending: 4000000, months: 0.5 });
  });

  test("waits for one complete month", () => {
    const transactions = [spend("rent", 100, "2026-09-02")];
    expect(emergencyFundCoverage(transactions, accountList, sep, "2026-09-02")).toEqual({
      ready: false,
      monthsToGo: 1,
    });
  });
});

describe("INS-04 month-to-date pace", () => {
  // Food: ₹30,000 in each of June, July and August.
  const history = ["06", "07", "08"].map((m) => spend("groceries", 3000000, `2026-${m}-15`));

  test("day 10 of 30: 65% of a usual month is running hot", () => {
    const transactions = [...history, spend("groceries", 1950000, "2026-09-05")];
    const result = monthToDatePace(transactions, accounts, categoryOf, sep, "2026-09-10", "2026-06-01");
    if (!result.ready) throw new Error("not ready");
    const food = result.byCategory.get("food")!;
    expect(result.day).toBe(10);
    expect(food).toEqual({
      spent: 1950000,
      typical: 3000000,
      expected: 1000000,
      shareOfTypical: 0.65,
      runningHot: true,
    });
  });

  test("up to 20% ahead isn't flagged", () => {
    const transactions = [...history, spend("groceries", 1200000, "2026-09-05")];
    const result = monthToDatePace(transactions, accounts, categoryOf, sep, "2026-09-10", "2026-06-01");
    expect(result.ready && result.total.runningHot).toBe(false);
  });

  test("needs 3 months of history", () => {
    expect(monthToDatePace([], accounts, categoryOf, sep, "2026-09-10", "2026-08-20")).toEqual({
      ready: false,
      monthsToGo: 1,
    });
  });
});

describe("INS-05 category trends", () => {
  test("eating out at 1.6× its typical month is flagged", () => {
    const transactions = [
      ...["06", "07", "08"].map((m) => spend("eating-out", 500000, `2026-${m}-15`)),
      spend("eating-out", 800000, "2026-09-15"),
      spend("rickshaw", 100000, "2026-08-15"),
      spend("rickshaw", 140000, "2026-09-15"),
    ];
    const result = categoryTrends(transactions, categoryOf, sep, "2026-06-01");
    if (!result.ready) throw new Error("not ready");
    expect(result.byCategory.get("food")).toEqual({
      thisMonth: 800000,
      lastMonth: 500000,
      typical: 500000,
      multiple: 1.6,
      flagged: true,
      history: [0, 0, 500000, 500000, 500000, 800000],
    });
    // Typical is the average of June (0), July (0) and August.
    expect(result.byCategory.get("transport")?.typical).toBe(33333);
  });
});

describe("INS-06 small-spend leak", () => {
  test("20 rickshaw rides at ₹120 is ₹2,400 a month and ₹28,800 a year (UAT-10)", () => {
    const rides = Array.from({ length: 20 }, (_, i) =>
      spend("rickshaw", 12000, `2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const transactions = [
      ...rides,
      spend("groceries", 19999, "2026-09-02"),
      spend("groceries", 20000, "2026-09-02"), // not under ₹200
      spend("junk", 5000, "2026-09-03"),
      spend("junk", 5000, "2026-10-03"), // next month
    ];
    expect(smallSpendLeak(transactions, sep, 20000).slice(0, 3)).toEqual([
      { subcategoryId: "rickshaw", count: 20, total: 240000, yearly: 2880000 },
      { subcategoryId: "groceries", count: 1, total: 19999, yearly: 239988 },
      { subcategoryId: "junk", count: 1, total: 5000, yearly: 60000 },
    ]);
  });
});

describe("INS-07 and INS-08", () => {
  test("₹2.50 on healthy food for every ₹1 on junk", () => {
    const transactions = [spend("healthy", 250000, "2026-09-02"), spend("junk", 100000, "2026-09-03")];
    const [month] = healthyVsJunk(transactions, new Set(["healthy"]), new Set(["junk"]), sep, 1);
    expect(month).toMatchObject({ healthy: 250000, junk: 100000, ratio: 2.5 });
  });

  test("₹300 untracked out of ₹60,000 is 0.5%", () => {
    const transactions = [spend("lost", 30000, "2026-09-02"), spend("rent", 5970000, "2026-09-03")];
    const [month] = trackingAccuracy(transactions, accounts, "lost", sep, 1);
    expect(month).toMatchObject({ lostTrack: 30000, spending: 6000000, share: 0.005 });
  });
});

describe("INS-12 payday effect", () => {
  test("daily spending in the week from payday vs the other days", () => {
    const transactions: Transaction[] = [];
    for (const m of ["06", "07", "08"]) {
      transactions.push(salary(`2026-${m}-01`));
      transactions.push(spend("eating-out", 700000, `2026-${m}-03`)); // week after payday
      transactions.push(spend("eating-out", 1600000, `2026-${m}-20`)); // the rest
      transactions.push(spend("rent", 1500000, `2026-${m}-01`, { recurring_id: "rent" }));
    }
    const result = paydayEffect(transactions, new Set(["salary"]), sep, "2026-06-01");
    // 21 days after payday: ₹21,000 → ₹1,000/day. 71 other days: ₹48,000 → ₹676.06/day.
    expect(result).toEqual({ ready: true, afterPayday: 100000, otherDays: 67606, multiple: 100000 / 67606, months: 3 });
  });
});

describe("INS-15 family and giving", () => {
  test("this year and this month, by subcategory", () => {
    const transactions = [
      spend("family", 800000, "2026-01-05"),
      spend("family", 800000, "2026-09-05"),
      spend("friends", 50000, "2026-09-06"),
      spend("rent", 1500000, "2026-09-05"),
      spend("family", 800000, "2025-12-05"),
    ];
    const result = familyAndGiving(transactions, categoryOf, "giving", sep, "2026-09-10");
    expect(result.yearTotal).toBe(1650000);
    expect(result.monthTotal).toBe(850000);
    expect(result.year.get("family")).toBe(1600000);
  });
});

describe("INS-18 net position", () => {
  test("at the end of each month, this month as of today", () => {
    const transactions = [
      spend("rent", 1500000, "2026-08-05"),
      spend("groceries", 50000, "2026-09-05", { account_id: "card" }),
      spend("groceries", 70000, "2026-09-25"),
    ];
    expect(netPositionTrend(accountList, transactions, sep, "2026-09-10", 2).map((m) => m.netPosition)).toEqual([
      8500000, 8450000,
    ]);
  });
});
