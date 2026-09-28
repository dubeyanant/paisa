import { assertPaise } from "./money";
import type { Account, Transaction } from "./types";

// How a transaction moves each account's balance (BR-1 to BR-5, BR-8, BR-13).
// Planned entries don't move anything until confirmed (BR-7).
function applyToBalances(balances: Map<string, number>, t: Transaction) {
  if (t.is_planned) return;
  assertPaise(t.amount);
  const add = (accountId: string, delta: number) =>
    balances.set(accountId, (balances.get(accountId) ?? 0) + delta);

  switch (t.kind) {
    case "expense":
      add(t.account_id, -t.amount);
      break;
    case "income":
    case "refund":
    case "adjustment": // signed
      add(t.account_id, t.amount);
      break;
    case "transfer":
      add(t.account_id, -t.amount);
      add(t.to_account_id!, t.amount);
      break;
  }
}

// Each account's balance: opening balance plus every confirmed transaction up
// to and including `asOf` (default: all of them). A credit card's balance is
// negative while money is owed.
export function accountBalances(
  accounts: Account[],
  transactions: Transaction[],
  asOf?: Date,
): Map<string, number> {
  const balances = new Map(accounts.map((a) => [a.id, a.opening_balance]));
  const cutoff = asOf?.getTime();
  for (const t of transactions) {
    if (cutoff !== undefined && Date.parse(t.occurred_at) > cutoff) continue;
    applyToBalances(balances, t);
  }
  return balances;
}

// What's owed on a credit card: card spends − payments − refunds and cashback
// credited to the card (FR-1 AC3). Negative if the card is in credit.
export function cardOutstanding(balance: number): number {
  return 0 - balance; // not -balance, which turns 0 into -0
}

export type BalanceSummary = {
  // Bank + wallet (FR-1).
  available: number;
  // Total owed across credit cards.
  cardDues: number;
  // Total in savings and investment accounts.
  savings: number;
  // available + savings − cardDues (INS-18).
  netPosition: number;
};

export function balanceSummary(accounts: Account[], balances: Map<string, number>): BalanceSummary {
  let available = 0;
  let cardDues = 0;
  let savings = 0;
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0;
    if (account.type === "bank" || account.type === "wallet") available += balance;
    else if (account.type === "credit_card") cardDues += cardOutstanding(balance);
    else savings += balance;
  }
  return { available, cardDues, savings, netPosition: available + savings - cardDues };
}
