import { describe, expect, test } from "bun:test";
import { budgetMonthOf, type Period } from "@/lib/finance/dates";
import type { RecurringPayment } from "@/lib/finance/detection";
import type { CategoryTrend, Pace, SavingsMonth } from "@/lib/finance/insights";
import type { TagReport } from "@/lib/finance/tags";
import {
  emergencyHeadline,
  howOften,
  notReady,
  paceHeadline,
  savingsHeadline,
  smallSpendHeadline,
  subscriptionsHeadline,
  tagComparison,
  tagHeadline,
  trendHeadline,
} from "./insights";

const sep = budgetMonthOf("2026-09-01");
const aug = budgetMonthOf("2026-08-01");
const names = (id: string) => ({ food: "Food", fun: "Fun", home: "Home" })[id] ?? id;

const month = (period: Period, income: number, spending: number): SavingsMonth => ({
  period,
  income,
  spending,
  saved: income - spending,
  rate: income > 0 ? (income - spending) / income : null,
  invested: 0,
});

test("notReady", () => {
  expect(notReady(1)).toBe("Available after 1 more month of entries.");
  expect(notReady(2)).toBe("Available after 2 more months of entries.");
});

test("INS-02 savings rate, finished months only", () => {
  expect(savingsHeadline([month(aug, 6000000, 4800000), month(sep, 6000000, 4500000)])).toBe(
    "You saved 25% last month (₹15,000), up from 20% the month before.",
  );
  expect(savingsHeadline([month(aug, 6000000, 4500000), month(sep, 6000000, 4800000)])).toBe(
    "You saved 20% last month (₹12,000), down from 25% the month before.",
  );
  expect(savingsHeadline([month(aug, 0, 0), month(sep, 6000000, 6600000)])).toBe(
    "You spent ₹6,000 more than you earned last month.",
  );
  expect(savingsHeadline([month(sep, 0, 100)])).toBe("No income last month, so there's no savings rate.");
  expect(savingsHeadline([])).toBe("Shows once your first month is over.");
  // Little income recorded: no -7,500% rates.
  expect(savingsHeadline([month(aug, 10000, 760000)])).toBe("You spent ₹7,500 more than you earned last month.");
  expect(savingsHeadline([month(aug, 10000, 760000), month(sep, 6000000, 4500000)])).toBe(
    "You saved 25% last month (₹15,000).",
  );
});

test("INS-03 emergency fund", () => {
  const fund = { ready: true as const, balance: 10000000, monthlySpending: 4000000, months: 2.5 };
  expect(emergencyHeadline(fund, true)).toBe("Your emergency fund covers 2.5 months of expenses.");
  expect(emergencyHeadline({ ready: false, monthsToGo: 1 }, true)).toBe(notReady(1));
  expect(emergencyHeadline(fund, false)).toStartWith("Mark a savings account");
});

describe("INS-04 pace", () => {
  const pace = (spent: number, typical: number, expected: number): Pace => ({
    spent,
    typical,
    expected,
    shareOfTypical: typical > 0 ? spent / typical : null,
    runningHot: expected > 0 && 5 * spent > 6 * expected,
  });

  test("running hot, and by category", () => {
    const byCategory = new Map([
      ["food", pace(650000, 1000000, 330000)],
      ["home", pace(100, 1000, 330)],
    ]);
    expect(paceHeadline({ ready: true, day: 10, total: pace(650000, 1000000, 330000), byCategory }, names)).toBe(
      "Day 10: you've spent 65% of a usual month. You're running hot, most of all on Food.",
    );
    expect(paceHeadline({ ready: true, day: 10, total: pace(300000, 1000000, 330000), byCategory }, names)).toBe(
      "Day 10: you've spent 30% of a usual month. Food is running hot.",
    );
    expect(
      paceHeadline({ ready: true, day: 10, total: pace(300000, 1000000, 330000), byCategory: new Map() }, names),
    ).toBe("Day 10: you've spent 30% of a usual month. Every category is on pace.");
  });

  test("not ready", () => {
    expect(paceHeadline({ ready: false, monthsToGo: 2 }, names)).toBe(notReady(2));
  });
});

test("INS-05 trends", () => {
  const trend = (thisMonth: number, typical: number): CategoryTrend => ({
    thisMonth,
    lastMonth: 0,
    typical,
    multiple: typical > 0 ? thisMonth / typical : null,
    flagged: typical > 0 && 2 * thisMonth >= 3 * typical,
    history: [],
  });
  const byCategory = new Map([
    ["food", trend(1600000, 1000000)],
    ["fun", trend(400000, 100000)],
    ["home", trend(100, 100)],
  ]);
  expect(trendHeadline({ ready: true, byCategory }, names)).toBe(
    "Food is already 1.6× your usual this month. 1 more is well above usual too.",
  );
  expect(trendHeadline({ ready: true, byCategory: new Map([["home", trend(100, 100)]]) }, names)).toBe(
    "No category is well above its usual this month.",
  );
});

test("INS-06 small spends (UAT-10)", () => {
  const top = { subcategoryId: "rickshaw", count: 20, total: 240000, yearly: 2880000 };
  expect(smallSpendHeadline(top, "Rickshaw", 20000)).toBe(
    "Rickshaw: 20 spends, ₹2,400 in the last 30 days, about ₹28,800 a year.",
  );
  expect(smallSpendHeadline(undefined, "", 20000)).toBe("No spends under ₹200 in the last 30 days.");
});

test("INS-09 subscriptions (UAT-8)", () => {
  const payment = (amount: number, change: RecurringPayment["priceChange"]): RecurringPayment => ({
    commitment: null,
    series: null,
    schedule: { unit: "month", every: 1 },
    amount,
    monthly: amount,
    yearly: amount * 12,
    priceChange: change,
  });
  const payments = [payment(1500000, null), payment(19900, { from: 14900, to: 19900, on: "2026-09-05" })];
  expect(subscriptionsHeadline(payments, (p) => (p.amount === 19900 ? "Streaming" : "Rent"))).toBe(
    "2 recurring payments cost about ₹15,199 a month, ₹1,82,388 a year. Streaming went from ₹149 to ₹199.",
  );
  expect(subscriptionsHeadline([], () => "")).toBe("No recurring payments yet.");
  expect(howOften({ unit: "month", every: 3 })).toBe("Every 3 months");
  expect(howOften({ unit: "year", every: 1 })).toBe("Yearly");
});

describe("INS-13 tags", () => {
  const report = (fields: Partial<TagReport>): TagReport => ({
    tagId: "goa",
    count: 12,
    total: 1800000,
    firstDate: "2026-05-01",
    lastDate: "2026-05-06",
    days: 6,
    perDay: 300000,
    byCategory: new Map([
      ["fun", 720000],
      ["food", 600000],
      ["home", 480000],
    ]),
    bySubcategory: new Map(),
    vsOthers: 1.4,
    ...fields,
  });

  test("the headline", () => {
    expect(tagHeadline("Goa Trip", report({}), names)).toBe(
      "Goa Trip: ₹18,000 over 6 days, ₹3,000/day; 40% on Fun.",
    );
    expect(tagHeadline("Dinner", report({ days: 1, total: 250000, perDay: 250000, byCategory: new Map([["food", 250000]]) }), names)).toBe(
      "Dinner: ₹2,500 over 1 day, ₹2,500/day, all on Food.",
    );
    expect(tagHeadline("Diwali", report({ total: 0 }), names)).toBe("Diwali: nothing spent yet.");
  });

  test("against other tags", () => {
    expect(tagComparison(report({}))).toBe("40% more a day than your other tags.");
    expect(tagComparison(report({ vsOthers: 0.75 }))).toBe("25% less a day than your other tags.");
    expect(tagComparison(report({ vsOthers: 1.02 }))).toBe("About the same a day as your other tags.");
    expect(tagComparison(report({ vsOthers: null }))).toBeNull();
  });
});
