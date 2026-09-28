// Builders for made-up test data (TD-6: never real data in tests).

import type { Account, AccountType, Transaction } from "./types";

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
