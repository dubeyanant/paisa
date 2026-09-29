// Logic behind the Add screen (FR-2, FR-3): what to suggest, and checking what
// was entered before it's saved. Amounts are paise (TD-8).

import { fromIstDateTimeInput } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import type { AccountType, TransactionKind } from "@/lib/finance/types";

// What the Add screen can create. Adjustments are balance corrections, not entries.
export type EntryKind = "expense" | "income" | "refund" | "transfer";

export const ENTRY_KINDS: { kind: EntryKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Transfer" },
  { kind: "refund", label: "Refund" },
];

// The kind of subcategory an entry needs: refunds reduce an expense subcategory (BR-6).
export function categoryKindOf(kind: TransactionKind): "expense" | "income" | null {
  if (kind === "expense" || kind === "refund") return "expense";
  if (kind === "income") return "income";
  return null;
}

// A transfer into a card or loan is a bill payment (TD-13), and reads as one.
export function transferLabel(toType: AccountType | undefined) {
  if (toType === "credit_card") return "Pay bill";
  if (toType === "loan") return "Repay loan";
  return "Transfer";
}

// A past transaction, as the suggestions need it. Lists are newest first.
export type RecentEntry = {
  kind: TransactionKind;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  note: string | null;
  occurred_at: string;
};

// What the Add screen may offer: active accounts and visible subcategories.
export type Usable = { accounts: Set<string>; subcategories: Set<string> };

export type QuickPick = {
  kind: EntryKind;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  note: string | null;
  // The amount used most often for this combination (the latest one on a tie).
  amount: number;
  uses: number;
};

export function normalizeNote(note: string | null) {
  return (note ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// One-tap suggestions: combinations of kind, subcategory, accounts and note used
// at least `minUses` times (FR-2 AC2), most used first.
export function quickPicks(
  recent: RecentEntry[],
  usable: Usable,
  { minUses = 3, limit = 8 } = {},
): QuickPick[] {
  type Group = { pick: Omit<QuickPick, "amount" | "uses">; amounts: Map<number, number>; order: number[]; first: number };
  const groups = new Map<string, Group>();
  recent.forEach((entry, index) => {
    if (entry.kind === "adjustment") return;
    const key = [entry.kind, entry.subcategory_id, entry.account_id, entry.to_account_id, normalizeNote(entry.note)].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        pick: {
          kind: entry.kind,
          account_id: entry.account_id,
          to_account_id: entry.to_account_id,
          subcategory_id: entry.subcategory_id,
          note: entry.note?.trim() || null,
        },
        amounts: new Map(),
        order: [],
        first: index,
      };
      groups.set(key, group);
    }
    if (!group.amounts.has(entry.amount)) group.order.push(entry.amount);
    group.amounts.set(entry.amount, (group.amounts.get(entry.amount) ?? 0) + 1);
  });

  const picks: { pick: QuickPick; first: number }[] = [];
  for (const { pick, amounts, order, first } of groups.values()) {
    const uses = [...amounts.values()].reduce((a, b) => a + b, 0);
    if (uses < minUses) continue;
    if (!usable.accounts.has(pick.account_id)) continue;
    if (pick.to_account_id && !usable.accounts.has(pick.to_account_id)) continue;
    if (pick.subcategory_id && !usable.subcategories.has(pick.subcategory_id)) continue;
    // `order` lists amounts newest first, so the first with the top count wins a tie.
    const amount = order.reduce((best, a) => (amounts.get(a)! > amounts.get(best)! ? a : best));
    picks.push({ pick: { ...pick, amount, uses }, first });
  }
  return picks
    .sort((a, b) => b.pick.uses - a.pick.uses || a.first - b.first)
    .slice(0, limit)
    .map((p) => p.pick);
}

// The account entries default to: the one used most by recent expenses, else
// the first active account (FR-2).
export function defaultAccount(recent: RecentEntry[], activeAccountIds: string[]): string | null {
  const active = new Set(activeAccountIds);
  const counts = new Map<string, number>();
  for (const entry of recent) {
    if (entry.kind !== "expense" || !active.has(entry.account_id)) continue;
    counts.set(entry.account_id, (counts.get(entry.account_id) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, count] of counts) if (best === null || count > counts.get(best)!) best = id;
  return best ?? activeAccountIds[0] ?? null;
}

// The subcategories used most for this kind of category, for one-tap choice.
export function frequentSubcategories(
  recent: RecentEntry[],
  categoryKind: "expense" | "income",
  usable: Usable,
  limit = 8,
): string[] {
  const counts = new Map<string, number>();
  for (const entry of recent) {
    if (!entry.subcategory_id || categoryKindOf(entry.kind) !== categoryKind) continue;
    if (!usable.subcategories.has(entry.subcategory_id)) continue;
    counts.set(entry.subcategory_id, (counts.get(entry.subcategory_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

// The subcategory last used with each note, so typing a known note picks it
// (FR-2). Keyed by category kind and normalised note.
export function noteMemory(recent: RecentEntry[], usable: Usable): Map<string, string> {
  const memory = new Map<string, string>();
  for (const entry of recent) {
    const note = normalizeNote(entry.note);
    const categoryKind = categoryKindOf(entry.kind);
    if (!note || !categoryKind || !entry.subcategory_id) continue;
    if (!usable.subcategories.has(entry.subcategory_id)) continue;
    const key = `${categoryKind}|${note}`;
    if (!memory.has(key)) memory.set(key, entry.subcategory_id);
  }
  return memory;
}

// --- Checking an entry --------------------------------------------------------

export type EntryLineInput = {
  // Made in the browser, so saving the same entry twice can't create it twice.
  id: string;
  amount: string;
  subcategory_id: string | null;
  note: string;
};

export type EntryInput = {
  kind: EntryKind;
  account_id: string;
  to_account_id: string | null;
  // IST "YYYY-MM-DDTHH:mm", or null for the moment it's saved.
  occurred_at: string | null;
  description: string;
  lines: EntryLineInput[];
};

export type TransactionInsert = {
  id: string;
  kind: EntryKind;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  subcategory_id: string | null;
  note: string | null;
  description: string | null;
  occurred_at: string;
  is_planned: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_LINES = 20;

// Turns what was entered into rows to insert. Every line shares the kind,
// account, date and time (FR-2 AC3). A future date makes the entry planned (BR-7).
export function parseEntry(
  input: EntryInput,
  now: Date,
): { ok: true; rows: TransactionInsert[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });

  if (!ENTRY_KINDS.some((k) => k.kind === input.kind)) return fail("Choose what kind of entry this is.");
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return fail("Enter an amount.");
  if (lines.length > MAX_LINES) return fail(`Save at most ${MAX_LINES} lines at a time.`);
  if (input.kind === "transfer" && lines.length > 1) return fail("A transfer has a single amount.");

  if (!UUID.test(input.account_id ?? "")) return fail("Choose an account.");
  let to_account_id: string | null = null;
  if (input.kind === "transfer") {
    if (!UUID.test(input.to_account_id ?? "")) return fail("Choose the account the money goes to.");
    if (input.to_account_id === input.account_id) return fail("Choose two different accounts.");
    to_account_id = input.to_account_id;
  }

  const when = input.occurred_at ? fromIstDateTimeInput(input.occurred_at) : now;
  if (!when) return fail("Enter a valid date and time.");

  const description = String(input.description ?? "").trim();
  if (description.length > 500) return fail("Keep the description to 500 characters or fewer.");

  const rows: TransactionInsert[] = [];
  for (const [index, line] of lines.entries()) {
    const which = lines.length > 1 ? ` on line ${index + 1}` : "";
    if (!UUID.test(line.id ?? "")) return fail("Something went wrong. Reload and try again.");
    const amount = parseRupees(String(line.amount ?? ""));
    if (!amount) return fail(`Enter an amount${which}.`);
    let subcategory_id: string | null = null;
    if (input.kind !== "transfer") {
      if (!UUID.test(line.subcategory_id ?? "")) return fail(`Choose a category${which}.`);
      subcategory_id = line.subcategory_id;
    }
    const note = String(line.note ?? "").trim();
    if (note.length > 200) return fail(`Keep the note${which} to 200 characters or fewer.`);
    rows.push({
      id: line.id,
      kind: input.kind,
      amount,
      account_id: input.account_id,
      to_account_id,
      subcategory_id,
      note: note || null,
      description: description || null,
      occurred_at: when.toISOString(),
      is_planned: when.getTime() > now.getTime(),
    });
  }
  return { ok: true, rows };
}
