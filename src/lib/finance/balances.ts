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

// What's owed on a credit card or loan: spends − payments − refunds and cashback
// credited to the card (FR-1 AC3). Negative if the card is in credit.
export function cardOutstanding(balance: number): number {
  return 0 - balance; // not -balance, which turns 0 into -0
}

export type BalanceSummary = {
  // Bank + wallet (FR-1), blocked accounts included.
  available: number;
  // In blocked bank and wallet accounts: set aside for bills and planned
  // spending, so not free to spend.
  blocked: number;
  // Total owed across credit cards. A card in credit doesn't reduce what's
  // owed on the others.
  cardDues: number;
  // Total held in your favour on cards and loans that are in credit, for
  // example after a refund bigger than the bill.
  cardCredit: number;
  // Total in savings and investment accounts.
  savings: number;
  // Total in deposits: money held elsewhere that comes back.
  deposits: number;
  // Total owed across loans.
  loansOwed: number;
  // Everything owned minus everything owed (INS-18).
  netPosition: number;
  // Bank and cash minus blocked money and card dues: what's really free to
  // spend right now.
  spendable: number;
};

export function balanceSummary(accounts: Account[], balances: Map<string, number>): BalanceSummary {
  const summary = { available: 0, blocked: 0, cardDues: 0, cardCredit: 0, savings: 0, deposits: 0, loansOwed: 0 };
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0;
    switch (account.type) {
      case "bank":
      case "wallet":
        summary.available += balance;
        if (account.is_blocked) summary.blocked += balance;
        break;
      case "credit_card":
      case "loan": {
        const owed = cardOutstanding(balance);
        if (owed < 0) summary.cardCredit -= owed;
        else if (account.type === "loan") summary.loansOwed += owed;
        else summary.cardDues += owed;
        break;
      }
      case "savings":
        summary.savings += balance;
        break;
      case "deposit":
        summary.deposits += balance;
        break;
    }
  }
  const { available, blocked, cardDues, cardCredit, savings, deposits, loansOwed } = summary;
  return {
    ...summary,
    netPosition: available + savings + deposits + cardCredit - cardDues - loansOwed,
    spendable: available - blocked - cardDues,
  };
}
