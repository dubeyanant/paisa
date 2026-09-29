// Headlines for the Home screen (FR-8): last month's savings rate (INS-02) and
// everyday spending pace (INS-04). Each is a number with a few words (FR-8
// AC2). The figures come from src/lib/finance/.

import { hotEnough } from "@/lib/finance/alerts";
import type { Pace, Ready, SavingsMonth } from "@/lib/finance/insights";
import { formatINR } from "@/lib/finance/money";

// 0.254 → "25%", -0.12 → "-12%".
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// 1.66 → "1.6×". Rounded down, so a category flagged at 1.5× never reads 1.4×.
export function times(multiple: number): string {
  return `${(Math.floor(multiple * 10) / 10).toFixed(1)}×`;
}

// INS-02 for last month, the latest finished one (`months` is the month
// before it, then it). Until a month ends, rent and bills still to pay look like
// money saved, so this month has no rate yet.
export function savingsText(months: SavingsMonth[], firstDate: string | null): { figure: string; text: string } {
  const last = months[months.length - 1];
  const before = months[months.length - 2];
  const tracked = (m: SavingsMonth | undefined) => m !== undefined && firstDate !== null && m.period.end > firstDate;
  if (!tracked(last)) return { figure: "–", text: "After your first full month" };
  if (last.rate === null) return { figure: "–", text: "No income last month" };
  const saved = last.saved >= 0 ? formatINR(last.saved) : `${formatINR(-last.saved)} overspent`;
  return {
    figure: percent(last.rate),
    text: tracked(before) && before.rate !== null ? `${saved} · month before ${percent(before.rate)}` : saved,
  };
}

// INS-04 for all spending, or when it'll be ready (FR-9 AC2).
export function paceText(
  pace: Ready<{ day: number; total: Pace }>,
): { figure: string; text: string; hot: boolean } {
  if (!pace.ready) {
    const months = pace.monthsToGo === 1 ? "month" : "months";
    return { figure: "–", text: `Needs ${pace.monthsToGo} more ${months} of entries`, hot: false };
  }
  const { spent, expected, shareOfTypical } = pace.total;
  return {
    figure: shareOfTypical === null ? "–" : percent(shareOfTypical),
    text: `${formatINR(spent)} by day ${pace.day} · usual ${formatINR(expected)}`,
    hot: hotEnough(pace.total),
  };
}
