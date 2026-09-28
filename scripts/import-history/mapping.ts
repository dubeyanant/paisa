// Turns export rows into transactions using the owner's mapping (TD-12).
// The mapping itself lives in .private/ because it names the owner's accounts
// and people (TD-6); only its shape is defined here.

import { createHash } from "node:crypto";
import { cleanName, type ExportRow, type ExportType } from "./read-export";

type AccountType = "bank" | "credit_card" | "wallet" | "savings" | "loan" | "deposit";

export type AccountMapping = {
  // Name in Paisa. Defaults to the old name.
  name?: string;
  type: AccountType;
  isEmergencyFund?: boolean;
};

// What a matching row becomes. `to` is "Category > Subcategory" in Paisa.
export type Target =
  | { to: string } // expense or income, same kind as the row
  | { refund: string } // income row that's really money back on a purchase (BR-6)
  | { transferTo: string } // expense row that's really a transfer, to this old account name
  | { adjustment: true } // balance correction (BR-13)
  | { skip: string }; // not imported; the reason is reported

export type Rule = Target & {
  type: "Expense" | "Income";
  // Old names, compared without emoji and case.
  category: string;
  // Omit to match any subcategory; "" matches rows with none.
  subcategory?: string;
  note?: RegExp;
};

export type Mapping = {
  accounts: Record<string, AccountMapping>;
  // Subcategories to create before importing.
  newSubcategories?: { category: string; name: string; bucket?: string }[];
  // First match wins.
  rules: Rule[];
  // Notes matching this become a tag named after the note (FR-14.2 "notes to tags").
  tagNotes?: RegExp;
};

export type PlannedTransaction = {
  line: number;
  kind: "expense" | "income" | "refund" | "transfer" | "adjustment";
  occurredAt: Date;
  // Paise. Signed only for adjustments.
  amount: number;
  // Paisa account names.
  account: string;
  toAccount: string | null;
  // "Category > Subcategory" in Paisa.
  subcategory: string | null;
  note: string | null;
  description: string | null;
  tags: string[];
  isPlanned: boolean;
  importKey: string;
  importSource: { account: string; category: string; subcategory: string; type: ExportType };
};

export type MappingResult = {
  planned: PlannedTransaction[];
  skipped: { row: ExportRow; reason: string }[];
  // Rows no rule covers. The import can't run until this is empty.
  unmapped: ExportRow[];
  // Old account names the mapping doesn't cover.
  unknownAccounts: string[];
};

const same = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

function ruleMatches(rule: Rule, row: ExportRow): boolean {
  if (rule.type !== row.type || !same(rule.category, row.category)) return false;
  if (rule.subcategory !== undefined && !same(rule.subcategory, row.subcategory)) return false;
  if (rule.note && !rule.note.test(row.note)) return false;
  return true;
}

// Identifies a row across exports, so re-importing a newer export skips rows
// already imported. Identical rows in one file are all kept (they can be two
// real rides), told apart by how many came before (FR-14.3).
export function importKeys(rows: ExportRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = [row.serial, row.account, row.type, row.category, row.subcategory, row.amount, row.note].join("␟");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${createHash("sha256").update(base).digest("hex").slice(0, 32)}#${n}`;
  });
}

// Title Case for tag names, so "Badlapur trip" and "Badlapur Trip" are one tag.
export function tagName(note: string): string {
  return note.trim().replace(/\s+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function applyMapping(rows: ExportRow[], mapping: Mapping, now: Date): MappingResult {
  const result: MappingResult = { planned: [], skipped: [], unmapped: [], unknownAccounts: [] };
  const unknown = new Set<string>();
  const accountName = (old: string) => {
    const entry = Object.entries(mapping.accounts).find(([name]) => same(name, old));
    if (!entry) {
      unknown.add(old);
      return old;
    }
    return entry[1].name ?? entry[0];
  };
  const keys = importKeys(rows);

  rows.forEach((row, i) => {
    const base = {
      line: row.line,
      occurredAt: row.occurredAt,
      account: accountName(row.account),
      toAccount: null as string | null,
      subcategory: null as string | null,
      note: row.note || null,
      description: row.description || null,
      tags: mapping.tagNotes?.test(row.note) ? [tagName(row.note)] : [],
      // Future-dated rows are planned until their date arrives (BR-7).
      isPlanned: row.occurredAt.getTime() > now.getTime(),
      importKey: keys[i],
      importSource: { account: row.account, category: row.category, subcategory: row.subcategory, type: row.type },
    };

    if (row.amount === 0) {
      result.skipped.push({ row, reason: "zero amount" });
      return;
    }
    if (row.type === "Transfer-In") {
      // The old app's mirror of a Transfer-Out; importing both would count it twice.
      result.skipped.push({ row, reason: "Transfer-In mirrors a Transfer-Out" });
      return;
    }
    if (row.type === "Transfer-Out") {
      result.planned.push({ ...base, kind: "transfer", amount: row.amount, toAccount: accountName(row.category) });
      return;
    }

    const rule = mapping.rules.find((r) => ruleMatches(r, row));
    if (!rule) {
      result.unmapped.push(row);
      return;
    }
    if ("skip" in rule) result.skipped.push({ row, reason: rule.skip });
    else if ("adjustment" in rule) {
      const signed = row.type === "Income" ? row.amount : -row.amount;
      result.planned.push({ ...base, kind: "adjustment", amount: signed });
    } else if ("transferTo" in rule) {
      result.planned.push({ ...base, kind: "transfer", amount: row.amount, toAccount: accountName(rule.transferTo) });
    } else if ("refund" in rule) {
      result.planned.push({ ...base, kind: "refund", amount: row.amount, subcategory: rule.refund });
    } else {
      const kind = row.type === "Income" ? "income" : "expense";
      result.planned.push({ ...base, kind, amount: row.amount, subcategory: rule.to });
    }
  });

  result.unknownAccounts = [...unknown];
  return result;
}
