// How an entry reads in a list: a title, a detail line and a signed amount.

import { transferLabel } from "@/lib/entry";
import { addDays, istDate } from "@/lib/finance/dates";
import type { AccountType, TransactionKind } from "@/lib/finance/types";

type Named = { name: string };
type EntryLike = {
  kind: TransactionKind;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  note: string | null;
};

export type EntryDescription = {
  title: string;
  detail: string;
  // Positive adds to the owner's money, negative takes from it, and a transfer
  // (money moving between the owner's own accounts) is neither.
  amount: number;
  direction: "in" | "out" | "move";
};

export function describeEntry(
  entry: EntryLike,
  accounts: Map<string, Named & { type: AccountType }>,
  subcategories: Map<string, Named>,
): EntryDescription {
  const account = accounts.get(entry.account_id)?.name ?? "Unknown account";
  const sub = entry.subcategory_id ? subcategories.get(entry.subcategory_id)?.name : undefined;
  const note = entry.note?.trim();
  const withSub = (prefix?: string) =>
    [prefix, note && sub ? sub : undefined, account].filter(Boolean).join(" · ");

  switch (entry.kind) {
    case "expense":
      return { title: note || sub || "Expense", detail: withSub(), amount: -entry.amount, direction: "out" };
    case "income":
      return { title: note || sub || "Income", detail: withSub(), amount: entry.amount, direction: "in" };
    case "refund":
      return { title: note || sub || "Refund", detail: withSub("Refund"), amount: entry.amount, direction: "in" };
    case "transfer": {
      const to = accounts.get(entry.to_account_id ?? "");
      return {
        title: note || transferLabel(to?.type),
        detail: `${account} → ${to?.name ?? "Unknown account"}`,
        amount: entry.amount,
        direction: "move",
      };
    }
    case "adjustment":
      return {
        title: note || "Balance correction",
        detail: account,
        amount: entry.amount,
        direction: entry.amount < 0 ? "out" : "in",
      };
  }
}

const dayFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayWithYearFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
});

// "Today", "Yesterday", "Tomorrow", "Mon, 28 Sep", or "28 Sep 2025" in another
// year. Days are IST days (TD-9).
export function istDayLabel(moment: string | Date, now: Date = new Date()): string {
  const day = istDate(moment);
  const today = istDate(now);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day === addDays(today, 1)) return "Tomorrow";
  const date = new Date(moment);
  return day.slice(0, 4) === today.slice(0, 4) ? dayFormat.format(date) : dayWithYearFormat.format(date);
}

export function istTime(moment: string | Date): string {
  return timeFormat.format(new Date(moment));
}
