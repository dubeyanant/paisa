import type { BucketAdherence } from "./budget";
import type { RecurringPayment } from "./detection";
import type { CategoryTrend, Pace, Ready } from "./insights";
import { recurringCost, type UpcomingItem } from "./recurring";

// INS-19 Top alerts: the flags raised by the other insights, ordered by rupee
// impact. The Home screen shows the top 3.

export type Alert =
  // INS-04: spending ahead of pace. categoryId is null for total spending.
  // Impact: spent − expected by today.
  | { kind: "pace"; categoryId: string | null; pace: Pace; impact: number }
  // INS-05: a category at 1.5× its typical month or more. Impact: the excess.
  | { kind: "trend"; categoryId: string; trend: CategoryTrend; impact: number }
  // INS-09: a price rise. Impact: the extra cost over a year.
  | { kind: "price"; payment: RecurringPayment; impact: number }
  // INS-17: a spending bucket over its target. Impact: the overspend.
  | { kind: "bucket"; adherence: BucketAdherence; impact: number }
  // INS-10: a due date passed and still unpaid. Impact: the amount.
  | { kind: "overdue"; item: UpcomingItem; impact: number };

export type AlertSources = {
  pace?: Ready<{ total: Pace; byCategory: Map<string, Pace> }>;
  trends?: Ready<{ byCategory: Map<string, CategoryTrend> }>;
  recurring?: RecurringPayment[];
  budget?: BucketAdherence[];
  upcoming?: UpcomingItem[];
};

export function alerts(sources: AlertSources): Alert[] {
  const found: Alert[] = [];

  // Pace and trend can both flag the same category; keep whichever matters more.
  const byCategory = new Map<string, Alert>();
  const keepBiggest = (categoryId: string, alert: Alert) => {
    const existing = byCategory.get(categoryId);
    if (!existing || alert.impact > existing.impact) byCategory.set(categoryId, alert);
  };
  if (sources.pace?.ready) {
    const { total, byCategory: paces } = sources.pace;
    if (total.runningHot) {
      found.push({ kind: "pace", categoryId: null, pace: total, impact: total.spent - total.expected });
    }
    for (const [categoryId, pace] of paces) {
      if (pace.runningHot) {
        keepBiggest(categoryId, { kind: "pace", categoryId, pace, impact: pace.spent - pace.expected });
      }
    }
  }
  if (sources.trends?.ready) {
    for (const [categoryId, trend] of sources.trends.byCategory) {
      if (trend.flagged) {
        keepBiggest(categoryId, { kind: "trend", categoryId, trend, impact: trend.thisMonth - trend.typical });
      }
    }
  }
  found.push(...byCategory.values());

  for (const payment of sources.recurring ?? []) {
    const change = payment.priceChange;
    if (change && change.to > change.from) {
      const impact = recurringCost(change.to - change.from, payment.schedule).yearly;
      found.push({ kind: "price", payment, impact });
    }
  }
  for (const adherence of sources.budget ?? []) {
    if (adherence.status === "over") {
      found.push({ kind: "bucket", adherence, impact: adherence.actual - adherence.target });
    }
  }
  for (const item of sources.upcoming ?? []) {
    if (item.overdue) found.push({ kind: "overdue", item, impact: item.amount });
  }

  return found.sort((a, b) => b.impact - a.impact);
}

export function topAlerts(sources: AlertSources, count = 3): Alert[] {
  return alerts(sources).slice(0, count);
}
