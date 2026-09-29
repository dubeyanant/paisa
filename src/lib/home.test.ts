import { describe, expect, test } from "bun:test";
import { budgetMonthOf, type Period } from "@/lib/finance/dates";
import type { SavingsMonth } from "@/lib/finance/insights";
import { paceText, percent, savingsText, times } from "./home";

const sep = budgetMonthOf("2026-09-01");
const aug = budgetMonthOf("2026-08-01");

test("percent and times", () => {
  expect(percent(0.254)).toBe("25%");
  expect(percent(-0.12)).toBe("-12%");
  expect(times(1.66)).toBe("1.6×");
  expect(times(1.5)).toBe("1.5×");
  expect(times(2)).toBe("2.0×");
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
      text: "₹15,000 · month before 20%",
    });
  });

  test("leaves out a month before the first entry", () => {
    expect(savingsText([month(aug, 0, 0), month(sep, 6000000, 6600000)], "2026-09-02")).toEqual({
      figure: "-10%",
      text: "₹6,000 overspent",
    });
  });

  test("before the first month is over, or with no income", () => {
    expect(savingsText([month(aug, 0, 0), month(sep, 0, 0)], "2026-10-02").text).toBe("After your first full month");
    expect(savingsText([month(aug, 1, 0), month(sep, 0, 500)], "2026-01-01").text).toBe("No income last month");
  });
});

test("paceText", () => {
  expect(paceText({ ready: false, monthsToGo: 1 }).text).toBe("Needs 1 more month of entries");
  const total = { spent: 650000, typical: 1000000, expected: 330000, shareOfTypical: 0.65, runningHot: true };
  expect(paceText({ ready: true, day: 10, total })).toEqual({
    figure: "65%",
    text: "₹6,500 by day 10 · usual ₹3,300",
    hot: true,
  });
});
