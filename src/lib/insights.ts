// Headlines for the Insights screen (FR-8.4): each insight in plain words with
// a number (FR-8 AC2), or when it'll be ready (FR-9 AC2). The figures come from
// src/lib/finance/.

import { streakLabel } from "@/lib/budget";
import type { BucketAdherence } from "@/lib/finance/budget";
import type { Commitment } from "@/lib/finance/types";
import type { RecurringPayment } from "@/lib/finance/detection";
import type {
  CategoryTrend,
  CommittedVsFree,
  EmergencyFund,
  Pace,
  Ready,
  SavingsMonth,
  SmallSpend,
} from "@/lib/finance/insights";
import { formatINR } from "@/lib/finance/money";
import type { UpcomingItem } from "@/lib/finance/recurring";
import type { TagReport } from "@/lib/finance/tags";
import { addDays } from "@/lib/finance/dates";
import { percent, times } from "@/lib/home";

// "Available after 2 more months of entries."
export function notReady(monthsToGo: number): string {
  return `Available after ${monthsToGo} more ${monthsToGo === 1 ? "month" : "months"} of entries.`;
}

// INS-01: "₹43,090 of your ₹82,641 income this month goes to planned payments (52%)."
export function committedHeadline(c: CommittedVsFree): string {
  if (c.income === 0) {
    return c.committed > 0
      ? `No income yet this month. ${formatINR(c.committed)} of planned payments are due.`
      : "No income yet this month.";
  }
  if (c.committed > c.income) {
    return `${formatINR(c.committed)} of planned payments are due this month, more than your ${formatINR(c.income)} income so far.`;
  }
  return `${formatINR(c.committed)} of your ${formatINR(c.income)} income this month goes to planned payments (${percent(c.committed / c.income)}).`;
}

// INS-02 over finished months, oldest first: "You saved 23% last month
// (₹19,000), down from 30% the month before."
export function savingsHeadline(months: SavingsMonth[]): string {
  if (months.length === 0) return "Shows once your first month is over.";
  const last = months[months.length - 1];
  const before = months.length > 1 ? months[months.length - 2] : undefined;
  if (last.rate === null) return "No income last month, so there's no savings rate.";
  const main =
    last.saved >= 0
      ? `You saved ${percent(last.rate)} last month (${formatINR(last.saved)})`
      : `You spent ${formatINR(-last.saved)} more than you earned last month`;
  if (!before || before.rate === null) return `${main}.`;
  const [a, b] = [Math.round(last.rate * 100), Math.round(before.rate * 100)];
  if (a === b) return `${main}, the same as the month before.`;
  return `${main}, ${a > b ? "up" : "down"} from ${percent(before.rate)} the month before.`;
}

// INS-03: "Your emergency fund covers 2.5 months of expenses."
export function emergencyHeadline(fund: Ready<EmergencyFund>, hasFund: boolean): string {
  if (!hasFund) return "Mark a savings account as your emergency fund to see how long it would last.";
  if (!fund.ready) return notReady(fund.monthsToGo);
  if (fund.months === null) return `Your emergency fund holds ${formatINR(fund.balance)}, and nothing was spent to measure it against.`;
  const months = Math.floor(fund.months * 10) / 10;
  return `Your emergency fund covers ${months.toFixed(1)} ${months === 1 ? "month" : "months"} of expenses.`;
}

// INS-04, planned payments left out: "Day 10: you've spent 65% of a usual
// month. Food is running hot."
export function paceHeadline(
  pace: Ready<{ day: number; total: Pace; byCategory: Map<string, Pace> }>,
  categoryName: (id: string) => string,
): string {
  if (!pace.ready) return notReady(pace.monthsToGo);
  const share = pace.total.shareOfTypical;
  const main =
    share === null ? `Day ${pace.day}: ${formatINR(pace.total.spent)} spent.` : `Day ${pace.day}: you've spent ${percent(share)} of a usual month.`;
  const hot = [...pace.byCategory]
    .filter(([, p]) => p.runningHot)
    .sort(([, a], [, b]) => b.spent - b.expected - (a.spent - a.expected))
    .map(([id]) => categoryName(id));
  if (pace.total.runningHot) return `${main} You're running hot${hot.length ? `, most of all on ${hot[0]}` : ""}.`;
  if (hot.length === 1) return `${main} ${hot[0]} is running hot.`;
  if (hot.length > 1) return `${main} ${hot[0]} and ${hot.length - 1} more are running hot.`;
  return `${main} Every category is on pace.`;
}

// INS-05: "Eating out is 1.6× your usual this month."
export function trendHeadline(
  trends: Ready<{ byCategory: Map<string, CategoryTrend> }>,
  categoryName: (id: string) => string,
): string {
  if (!trends.ready) return notReady(trends.monthsToGo);
  const flagged = [...trends.byCategory]
    .filter(([, t]) => t.flagged)
    .sort(([, a], [, b]) => b.thisMonth - b.typical - (a.thisMonth - a.typical));
  if (flagged.length === 0) return "No category is well above its usual this month.";
  const [id, top] = flagged[0];
  const more = flagged.length > 1 ? ` ${flagged.length - 1} more ${flagged.length === 2 ? "is" : "are"} well above usual too.` : "";
  return `${categoryName(id)} is already ${times(top.multiple!)} your usual this month.${more}`;
}

// INS-06 over the last 30 days: "Rickshaw: 20 spends, ₹2,400 in the last 30
// days, about ₹28,800 a year."
export function smallSpendHeadline(top: SmallSpend | undefined, name: string, threshold: number): string {
  if (!top) return `No spends under ${formatINR(threshold)} in the last 30 days.`;
  const spends = top.count === 1 ? "1 spend" : `${top.count} spends`;
  return `${name}: ${spends}, ${formatINR(top.total)} in the last 30 days, about ${formatINR(top.yearly)} a year.`;
}

// INS-09: what recurring payments cost, and the latest price rise.
export function subscriptionsHeadline(payments: RecurringPayment[], name: (p: RecurringPayment) => string): string {
  if (payments.length === 0) return "No recurring payments yet.";
  const monthly = payments.reduce((sum, p) => sum + p.monthly, 0);
  const yearly = payments.reduce((sum, p) => sum + p.yearly, 0);
  const count = payments.length === 1 ? "1 recurring payment" : `${payments.length} recurring payments`;
  const main = `${count} cost about ${formatINR(monthly)} a month, ${formatINR(yearly)} a year.`;
  const changed = payments
    .filter((p) => p.priceChange)
    .sort((a, b) => b.priceChange!.on.localeCompare(a.priceChange!.on))[0];
  if (!changed) return main;
  const { from, to } = changed.priceChange!;
  return `${main} ${name(changed)} went from ${formatINR(from)} to ${formatINR(to)}.`;
}

// "Monthly", "Every 3 months", "Weekly", "Yearly".
export function howOften({ unit, every }: Pick<Commitment, "unit" | "every">): string {
  if (every === 1) return { week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  return `Every ${every} ${unit}s`;
}

// INS-10: "₹30,000 due in the next 10 days."
export function upcomingHeadline(items: UpcomingItem[], today: string): string {
  const overdue = items.filter((i) => i.overdue).reduce((sum, i) => sum + i.amount, 0);
  const soon = items.filter((i) => !i.overdue && i.date <= addDays(today, 10)).reduce((sum, i) => sum + i.amount, 0);
  const later = items.filter((i) => !i.overdue).reduce((sum, i) => sum + i.amount, 0);
  if (overdue === 0 && later === 0) return "Nothing due in the next 30 days.";
  const parts = [
    soon > 0 ? `${formatINR(soon)} due in the next 10 days` : null,
    later > soon ? `${formatINR(later)} in the next 30` : null,
    overdue > 0 ? `${formatINR(overdue)} overdue` : null,
  ].filter(Boolean);
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// INS-17: "Wants at 36% vs 30% target. 3rd month over." The bucket that's
// furthest off, or all on track.
export function budgetHeadline(buckets: BucketAdherence[]): string {
  const off = buckets
    .filter((b) => b.status !== "on_track")
    .sort((a, b) => Number(b.status === "over") - Number(a.status === "over") || a.remaining - b.remaining);
  if (off.length === 0) return "Every bucket is on track this month.";
  const b = off[0];
  const share = b.shareOfBase === null ? "" : ` at ${percent(b.shareOfBase)} vs ${b.bucket.share_bp / 100}% target.`;
  const state = b.bucket.holds_savings ? " is behind" : b.status === "over" ? " is over its target" : " is at risk";
  const streak = streakLabel(b);
  return `${b.bucket.name}${share || `${state}.`}${streak ? ` ${streak}.` : ""}`;
}

// The small-spend thresholds Settings offers (INS-06), in paise. ₹200 is the
// default (BRD Q4).
export const SMALL_SPEND_OPTIONS = [5000, 10000, 15000, 20000, 30000, 50000, 100000];

// INS-13: "Goa Trip: ₹18,000 over 6 days, ₹3,000/day; 40% on Activities."
export function tagHeadline(name: string, r: TagReport, categoryName: (id: string) => string): string {
  if (r.total <= 0) return `${name}: nothing spent yet.`;
  const days = r.days === 1 ? "1 day" : `${r.days} days`;
  const main = `${name}: ${formatINR(r.total)} over ${days}, ${formatINR(r.perDay)}/day`;
  const [top, amount] = [...r.byCategory].sort(([, a], [, b]) => b - a)[0];
  if (r.byCategory.size < 2) return `${main}, all on ${categoryName(top)}.`;
  return `${main}; ${percent(amount / r.total)} on ${categoryName(top)}.`;
}

// INS-13 comparison: "40% more a day than your other tags."
export function tagComparison(r: TagReport): string | null {
  if (r.vsOthers === null || r.total <= 0) return null;
  const change = Math.round((r.vsOthers - 1) * 100);
  if (Math.abs(change) < 5) return "About the same a day as your other tags.";
  return `${Math.abs(change)}% ${change > 0 ? "more" : "less"} a day than your other tags.`;
}
