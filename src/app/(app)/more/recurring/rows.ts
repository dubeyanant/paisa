import "server-only";
import type { AccountOption, SubcategoryOption } from "@/lib/data/entries";
import type { CommitmentRow } from "@/lib/data/recurring";
import { describeEntry } from "@/lib/describe-entry";
import { transferLabel } from "@/lib/entry";
import { istDate } from "@/lib/finance/dates";
import { dayInSentence, describeSchedule, type DueNow } from "@/lib/recurring";
import type { Commitment } from "@/lib/finance/types";
import type { DueRow } from "./due-now";

export type Labels = { accounts: AccountOption[]; subcategories: SubcategoryOption[] };

export function lookups({ accounts, subcategories }: Labels) {
  return {
    accountById: new Map(accounts.map((a) => [a.id, a])),
    subById: new Map(subcategories.map((s) => [s.id, s])),
  };
}

type Lookups = ReturnType<typeof lookups>;

// Where the money goes: "Rent · Main Bank", or "Main Bank → Card".
export function paidWith(c: Pick<Commitment, "kind" | "account_id" | "to_account_id" | "subcategory_id">, l: Lookups) {
  const from = l.accountById.get(c.account_id)?.name ?? "Unknown account";
  if (c.kind === "transfer") {
    const to = l.accountById.get(c.to_account_id ?? "");
    return `${from} → ${to?.name ?? "Unknown account"}`;
  }
  const sub = l.subById.get(c.subcategory_id ?? "")?.name;
  return sub ? `${sub} · ${from}` : from;
}

// A name for something without one, such as a detected series.
export function fallbackName(c: Pick<Commitment, "kind" | "to_account_id" | "subcategory_id">, l: Lookups) {
  if (c.kind === "transfer") return transferLabel(l.accountById.get(c.to_account_id ?? "")?.type);
  return l.subById.get(c.subcategory_id ?? "")?.name ?? "Expense";
}

export function commitmentDetail(c: CommitmentRow, l: Lookups) {
  return `${describeSchedule(c)} · ${paidWith(c, l)}`;
}

export function dueRows(items: DueNow[], commitments: CommitmentRow[], l: Lookups, today: string): DueRow[] {
  const byId = new Map(commitments.map((c) => [c.id, c]));
  return items.map((item) => {
    if (item.type === "due") {
      const c = byId.get(item.commitment.id)!;
      return {
        type: "due",
        commitmentId: c.id,
        title: c.name,
        detail: paidWith(c, l),
        due_on: item.due_on,
        day: dayInSentence(item.due_on, today),
        overdue: item.due_on < today,
        more: item.more.length,
        amount: c.amount,
        variable: c.is_variable,
      };
    }
    const d = describeEntry({ ...item.entry, note: item.entry.note ?? null }, l.accountById, l.subById);
    return {
      type: "planned",
      entryId: item.entry.id,
      title: d.title,
      detail: d.detail,
      day: dayInSentence(istDate(item.entry.occurred_at), today),
      amount: item.entry.amount,
    };
  });
}

export function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
