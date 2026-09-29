import { describe, expect, test } from "bun:test";
import { topAlerts } from "./alerts";
import type { BucketAdherence } from "./budget";
import type { RecurringPayment } from "./detection";
import type { CategoryTrend, Pace } from "./insights";
import { commitment } from "./fixtures";

const streamingPlan = commitment({ id: "streaming", amount: 19900 });

const pace = (spent: number, expected: number): Pace => ({
  spent,
  typical: expected * 3,
  expected,
  shareOfTypical: null,
  runningHot: 5 * spent > 6 * expected,
});
const trend = (thisMonth: number, typical: number): CategoryTrend => ({
  thisMonth,
  lastMonth: typical,
  typical,
  multiple: thisMonth / typical,
  flagged: 2 * thisMonth >= 3 * typical,
  history: [],
});

describe("INS-19 top alerts", () => {
  test("the 3 biggest flags by rupee impact", () => {
    const streaming = {
      commitment: streamingPlan,
      schedule: { unit: "month", every: 1 },
      priceChange: { from: 14900, to: 19900, on: "2026-09-01" },
    } as RecurringPayment;
    const wants = { status: "over", actual: 2160000, target: 1800000 } as BucketAdherence;
    const alerts = topAlerts({
      pace: { ready: true, total: pace(100000, 100000), byCategory: new Map([["food", pace(1950000, 1000000)]]) },
      trends: { ready: true, byCategory: new Map([["fun", trend(800000, 500000)], ["food", trend(1950000, 3000000)]]) },
      recurring: [streaming],
      budget: [wants],
      upcoming: [{ date: "2026-09-05", amount: 1500000, commitment_id: "rent", transaction_id: null, overdue: true }],
    });
    expect(alerts.map((a) => [a.kind, a.impact])).toEqual([
      ["overdue", 1500000],
      ["pace", 950000],
      ["bucket", 360000],
    ]);
  });

  test("a category flagged by pace and trend appears once, and price drops aren't alerts", () => {
    const cheaper = {
      commitment: streamingPlan,
      schedule: { unit: "month", every: 1 },
      priceChange: { from: 19900, to: 14900, on: "2026-09-01" },
    } as RecurringPayment;
    const alerts = topAlerts({
      pace: { ready: true, total: pace(0, 0), byCategory: new Map([["fun", pace(700000, 300000)]]) },
      trends: { ready: true, byCategory: new Map([["fun", trend(800000, 500000)]]) },
      recurring: [cheaper],
    });
    expect(alerts.map((a) => [a.kind, a.impact])).toEqual([["pace", 400000]]);
  });

  test("a price rise costs the difference over a year", () => {
    const streaming = {
      commitment: streamingPlan,
      schedule: { unit: "month", every: 1 },
      priceChange: { from: 14900, to: 19900, on: "2026-09-01" },
    } as RecurringPayment;
    expect(topAlerts({ recurring: [streaming] })[0].impact).toBe(60000);
  });

  test("small flags and detected price changes aren't alerts", () => {
    const milk = {
      commitment: null,
      schedule: { unit: "month", every: 1 },
      priceChange: { from: 50000, to: 60000, on: "2026-09-01" },
    } as RecurringPayment;
    const smallRise = {
      commitment: streamingPlan,
      schedule: { unit: "month", every: 1 },
      priceChange: { from: 7700, to: 8000, on: "2026-09-01" },
    } as RecurringPayment;
    const slightlyOver = { status: "over", actual: 1850000, target: 1800000 } as BucketAdherence;
    const alerts = topAlerts({
      // ₹800 ahead of pace, and ₹900 over a usual month.
      pace: { ready: true, total: pace(0, 0), byCategory: new Map([["health", pace(420000, 340000)]]) },
      trends: { ready: true, byCategory: new Map([["bills", trend(190000, 100000)]]) },
      recurring: [milk, smallRise],
      budget: [slightlyOver],
    });
    expect(alerts).toEqual([]);
  });
});
