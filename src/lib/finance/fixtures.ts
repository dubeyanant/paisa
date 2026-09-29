// Builders for made-up test data (TD-6: never real data in tests).

import type { Account, AccountType, Commitment, Transaction } from "./types";

export function account(id: string, type: AccountType, opening_balance = 0): Account {
  return { id, type, opening_balance };
}

let nextId = 1;

export function tx(fields: Partial<Transaction> & Pick<Transaction, "kind" | "amount">): Transaction {
  return {
    id: `t${nextId++}`,
    occurred_at: "2026-09-10T06:30:00Z",
    account_id: "bank",
    to_account_id: null,
    subcategory_id: null,
    is_planned: false,
    bucket_override_id: null,
    ...fields,
  };
}

export function byId(accounts: Account[]) {
  return new Map(accounts.map((a) => [a.id, a]));
}

export function commitment(fields: Partial<Commitment> & Pick<Commitment, "id" | "amount">): Commitment {
  return {
    kind: "expense",
    is_variable: false,
    account_id: "bank",
    to_account_id: null,
    subcategory_id: fields.id,
    unit: "month",
    every: 1,
    first_due_on: "2026-01-01",
    ends_on: null,
    paused_at: null,
    ...fields,
  };
}

// A moment at noon IST on the date.
export function at(date: string): string {
  return `${date}T06:30:00Z`;
}
