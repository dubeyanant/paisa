import { describe, expect, test } from "bun:test";
import type { Alert } from "@/lib/finance/alerts";
import { budgetMonthOf, type Period } from "@/lib/finance/dates";
import { commitment } from "@/lib/finance/fixtures";
import type { SavingsMonth } from "@/lib/finance/insights";
import { alertText, paceText, percent, savingsText, times, type AlertNames } from "./home";

const sep = budgetMonthOf("2026-09-01");
const aug = budgetMonthOf("2026-08-01");
const ctx = { day: 10, month: sep, today: "2026-09-10" };
const names: AlertNames = {
  category: (id) => ({ food: "Food" })[id] ?? id,
  payment: (p) => (p.commitment ? "Streaming" : "Gym"),
  upcoming: () => "Rent",
};

test("percent and times", () => {
  expect(percent(0.254)).toBe("25%");
  expect(percent(-0.12)).toBe("-12%");
  expect(times(1.66)).toBe("1.6×");
  expect(times(1.5)).toBe("1.5×");
  expect(times(2)).toBe("2.0×");
});

describe("alertText", () => {
  const pace = { spent: 650000, typical: 1000000, expected: 330000, shareOfTypical: 0.65, runningHot: true };

  test("pace, for all spending and for a category", () => {
    expect(alertText({ kind: "pace", categoryId: null, pace, impact: 320000 }, names, ctx)).toEqual({
      title: "Spending is running hot",
      detail: "Day 10: ₹6,500 spent, 65% of a usual month.",
      href: "/entries?from=2026-09-01&to=2026-09-10&kind=expense",
    });
    const food = alertText({ kind: "pace", categoryId: "food", pace, impact: 320000 }, names, ctx);
    expect(food.title).toBe("Food is running hot");
    expect(food.href).toBe("/entries?from=2026-09-01&to=2026-09-10&category=food&kind=expense");
  });

  test("a category trend", () => {
    const trend = { thisMonth: 1600000, lastMonth: 0, typical: 1000000, multiple: 1.6, flagged: true, history: [] };
    const text = alertText({ kind: "trend", categoryId: "food", trend, impact: 600000 }, names, ctx);
    expect(text.title).toBe("Food is 1.6× your usual");
    expect(text.detail).toBe("₹16,000 this month, against ₹10,000 in a usual month.");
  });

  test("a price rise (UAT-8)", () => {
    const c = commitment({ id: "streaming", amount: 19900 });
    const payment = {
      commitment: c,
      series: null,
      schedule: { unit: "month" as const, every: 1 },
      amount: 19900,
      monthly: 19900,
      yearly: 238800,
      priceChange: { from: 14900, to: 19900, on: "2026-09-05" },
    };
    expect(alertText({ kind: "price", payment, impact: 60000 }, names, ctx)).toEqual({
      title: "Streaming went from ₹149 to ₹199",
      detail: "About ₹600 more a year.",
      href: "/more/planned/streaming",
    });
  });

  test("a bucket over its target, with its streak", () => {
    const history = [aug].map((period: Period) => ({ period, target: 1, actual: 2, onTarget: false }));
    const alert: Alert = {
      kind: "bucket",
      adherence: {
        bucket: { id: "wants", name: "Wants", share_bp: 3000, holds_savings: false },
        target: 1800000,
        actual: 2160000,
        remaining: -360000,
        shareOfBase: 0.36,
        status: "over",
        streak: 3,
        history,
      },
      impact: 360000,
    };
    expect(alertText(alert, names, ctx).detail).toBe("₹21,600 spent of ₹18,000. 3rd month over.");
  });

  test("an overdue payment", () => {
    const item = { date: "2026-09-05", amount: 1500000, commitment_id: "rent", transaction_id: null, overdue: true };
    expect(alertText({ kind: "overdue", item, impact: 1500000 }, names, ctx).title).toBe("Rent was due 5 Sep");
  });
});

describe("savingsText", () => {
  const month = (period: Period, income: number, spending: number): SavingsMonth => ({
    period,
    income,
    spending,
    saved: income - spending,
    rate: income > 0 ? (income - spending) / income : null,
    invested: 0,
  });

  test("last month, and the month before", () => {
    expect(savingsText([month(aug, 6000000, 4800000), month(sep, 6000000, 4500000)], "2026-01-01")).toEqual({
      figure: "25%",
      text: "₹15,000 saved. The month before: 20%.",
    });
  });

  test("leaves out a month before the first entry", () => {
    expect(savingsText([month(aug, 0, 0), month(sep, 6000000, 6600000)], "2026-09-02")).toEqual({
      figure: "-10%",
      text: "₹6,000 more spent than earned.",
    });
  });

  test("before the first month is over, or with no income", () => {
    expect(savingsText([month(aug, 0, 0), month(sep, 0, 0)], "2026-10-02").text).toBe("Shows once your first month is over.");
    expect(savingsText([month(aug, 1, 0), month(sep, 0, 500)], "2026-01-01").text).toBe("No income last month.");
  });
});

test("paceText", () => {
  expect(paceText({ ready: false, monthsToGo: 1 }).text).toBe("Shows after 1 more month of entries.");
  const total = { spent: 650000, typical: 1000000, expected: 330000, shareOfTypical: 0.65, runningHot: true };
  expect(paceText({ ready: true, day: 10, total })).toEqual({
    figure: "65%",
    text: "Day 10: ₹6,500 spent. A usual month has ₹3,300 by now.",
    hot: true,
  });
});
