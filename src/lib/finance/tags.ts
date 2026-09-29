import { daysBetween, istDate } from "./dates";
import { average } from "./totals";
import type { Tag, Transaction } from "./types";

// INS-13 Tag and trip reports.

export type TagReport = {
  tagId: string;
  count: number;
  // Expenses − refunds (BR-6).
  total: number;
  // The tag's own start and end dates if set, otherwise its first and last
  // transactions. Both days count.
  firstDate: string;
  lastDate: string;
  days: number;
  perDay: number;
  byCategory: Map<string, number>;
  bySubcategory: Map<string, number>;
  // perDay ÷ the average perDay of the other tags, or null with no others.
  vsOthers: number | null;
};

// A report for every tag in use, latest first.
export function tagReports(
  transactions: Transaction[],
  tagsByTransaction: Map<string, string[]>,
  tags: Tag[],
  categoryOf: Map<string, string>,
): TagReport[] {
  const tagged = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.is_planned || (t.kind !== "expense" && t.kind !== "refund")) continue;
    for (const tagId of tagsByTransaction.get(t.id) ?? []) {
      const list = tagged.get(tagId) ?? [];
      list.push(t);
      tagged.set(tagId, list);
    }
  }

  const reports: TagReport[] = [];
  for (const tag of tags) {
    const list = tagged.get(tag.id);
    if (!list) continue;
    const dates = list.map((t) => istDate(t.occurred_at)).sort();
    const firstDate = tag.starts_on ?? dates[0];
    const lastDate = tag.ends_on ?? dates[dates.length - 1];

    const bySubcategory = new Map<string, number>();
    for (const t of list) {
      const signed = t.kind === "expense" ? t.amount : -t.amount;
      bySubcategory.set(t.subcategory_id!, (bySubcategory.get(t.subcategory_id!) ?? 0) + signed);
    }
    const byCategory = new Map<string, number>();
    for (const [subcategory, amount] of bySubcategory) {
      const category = categoryOf.get(subcategory)!;
      byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
    }

    const total = [...bySubcategory.values()].reduce((sum, v) => sum + v, 0);
    const days = Math.max(daysBetween(firstDate, lastDate) + 1, 1);
    reports.push({
      tagId: tag.id,
      count: list.length,
      total,
      firstDate,
      lastDate,
      days,
      perDay: Math.round(total / days),
      byCategory,
      bySubcategory,
      vsOthers: null,
    });
  }

  for (const report of reports) {
    const others = average(reports.filter((r) => r !== report).map((r) => r.perDay));
    report.vsOthers = others ? report.perDay / others : null;
  }
  return reports.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
