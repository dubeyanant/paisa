// Headlines for the Home screen (FR-8): top alerts (INS-19), last month's
// savings rate (INS-02) and everyday spending pace (INS-04). Each is plain
// words with a number (FR-8 AC2). The figures come from src/lib/finance/.

import { streakLabel } from "@/lib/budget";
import { filtersQuery } from "@/lib/entry-filters";
import type { Alert } from "@/lib/finance/alerts";
import type { Period } from "@/lib/finance/dates";
import type { RecurringPayment } from "@/lib/finance/detection";
import type { Pace, Ready, SavingsMonth } from "@/lib/finance/insights";
import { formatINR } from "@/lib/finance/money";
import type { UpcomingItem } from "@/lib/finance/recurring";
import { dayInSentence } from "@/lib/recurring";

// 0.254 → "25%", -0.12 → "-12%".
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// 1.66 → "1.6×". Rounded down, so a category flagged at 1.5× never reads 1.4×.
export function times(multiple: number): string {
  return `${(Math.floor(multiple * 10) / 10).toFixed(1)}×`;
}

export type AlertNames = {
  category: (id: string) => string;
  // A commitment's name, or a name for a detected series.
  payment: (p: RecurringPayment) => string;
  upcoming: (item: UpcomingItem) => string;
};

export type AlertContext = { day: number; month: Period; today: string };

export type AlertText = { title: string; detail: string; href: string };

export function alertText(alert: Alert, names: AlertNames, { day, month, today }: AlertContext): AlertText {
  const entries = (category?: string) =>
    `/entries?${filtersQuery({ from: month.start, to: today, kind: "expense", category })}`;
  switch (alert.kind) {
    case "pace": {
      const { spent, shareOfTypical } = alert.pace;
      const share = shareOfTypical === null ? "" : `, ${percent(shareOfTypical)} of a usual month`;
      return {
        title: `${alert.categoryId ? names.category(alert.categoryId) : "Spending"} is running hot`,
        detail: `Day ${day}: ${formatINR(spent)} spent${share}.`,
        href: entries(alert.categoryId ?? undefined),
      };
    }
    case "trend": {
      const { thisMonth, typical, multiple } = alert.trend;
      return {
        title: `${names.category(alert.categoryId)} is ${times(multiple!)} your usual`,
        detail: `${formatINR(thisMonth)} this month, against ${formatINR(typical)} in a usual month.`,
        href: entries(alert.categoryId),
      };
    }
    case "price": {
      const { from, to } = alert.payment.priceChange!;
      return {
        title: `${names.payment(alert.payment)} went from ${formatINR(from)} to ${formatINR(to)}`,
        detail: `About ${formatINR(alert.impact)} more a year.`,
        href: alert.payment.commitment ? `/more/planned/${alert.payment.commitment.id}` : "/more/planned",
      };
    }
    case "bucket": {
      const { bucket, actual, target } = alert.adherence;
      const streak = streakLabel(alert.adherence);
      return {
        title: `${bucket.name} is over its target`,
        detail: `${formatINR(actual)} spent of ${formatINR(target)}.${streak ? ` ${streak}.` : ""}`,
        href: "/budget",
      };
    }
    case "overdue":
      return {
        title: `${names.upcoming(alert.item)} was due ${dayInSentence(alert.item.date, today)}`,
        detail: `${formatINR(alert.item.amount)}, not paid yet.`,
        href: "/more/planned",
      };
  }
}

// INS-02 for last month, the latest finished one (`months` is the month
// before it, then it). Until a month ends, rent and bills still to pay look like
// money saved, so this month has no rate yet.
export function savingsText(months: SavingsMonth[], firstDate: string | null): { figure: string; text: string } {
  const last = months[months.length - 1];
  const before = months[months.length - 2];
  const tracked = (m: SavingsMonth | undefined) => m !== undefined && firstDate !== null && m.period.end > firstDate;
  if (!tracked(last)) return { figure: "–", text: "Shows once your first month is over." };
  if (last.rate === null) return { figure: "–", text: "No income last month." };
  const saved = last.saved >= 0 ? `${formatINR(last.saved)} saved.` : `${formatINR(-last.saved)} more spent than earned.`;
  return {
    figure: percent(last.rate),
    text: tracked(before) && before.rate !== null ? `${saved} The month before: ${percent(before.rate)}.` : saved,
  };
}

// INS-04 for all spending, or when it'll be ready (FR-9 AC2).
export function paceText(
  pace: Ready<{ day: number; total: Pace }>,
): { figure: string; text: string; hot: boolean } {
  if (!pace.ready) {
    const months = pace.monthsToGo === 1 ? "month" : "months";
    return { figure: "–", text: `Shows after ${pace.monthsToGo} more ${months} of entries.`, hot: false };
  }
  const { spent, expected, shareOfTypical, runningHot } = pace.total;
  return {
    figure: shareOfTypical === null ? "–" : percent(shareOfTypical),
    text: `Day ${pace.day}: ${formatINR(spent)} spent. A usual month has ${formatINR(expected)} by now.`,
    hot: runningHot,
  };
}
