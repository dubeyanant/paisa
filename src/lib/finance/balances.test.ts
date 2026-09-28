import { describe, expect, test } from "bun:test";
import { accountBalances, balanceSummary, cardOutstanding } from "./balances";
import { account, tx } from "./fixtures";

describe("account balances", () => {
  test("an expense reduces the balance (FR-1 AC1, UAT-1)", () => {
    const accounts = [account("bank", "bank", 1000000)];
    const balances = accountBalances(accounts, [tx({ kind: "expense", amount: 12000 })]);
    expect(balances.get("bank")).toBe(988000);
  });

  test("card outstanding = spends − payments − refunds and cashback (FR-1 AC3)", () => {
    const accounts = [account("bank", "bank", 5000000), account("card", "credit_card")];
    const transactions = [
      tx({ kind: "expense", amount: 1500000, account_id: "card" }),
      tx({ kind: "transfer", amount: 1000000, account_id: "bank", to_account_id: "card" }),
      tx({ kind: "refund", amount: 20000, account_id: "card" }),
      tx({ kind: "income", amount: 5000, account_id: "card" }), // cashback (BR-8)
    ];
    const balances = accountBalances(accounts, transactions);
    expect(cardOutstanding(balances.get("card")!)).toBe(475000);
  });

  test("paying the card moves the same amount off both accounts (UAT-4)", () => {
    const accounts = [account("bank", "bank", 5000000), account("card", "credit_card", -1234567)];
    const payment = tx({ kind: "transfer", amount: 1234567, account_id: "bank", to_account_id: "card" });
    const balances = accountBalances(accounts, [payment]);
    expect(balances.get("bank")).toBe(5000000 - 1234567);
    expect(cardOutstanding(balances.get("card")!)).toBe(0);
  });

  test("adjustments change balances (BR-13)", () => {
    const accounts = [account("bank", "bank", 100000)];
    const balances = accountBalances(accounts, [tx({ kind: "adjustment", amount: -2550 })]);
    expect(balances.get("bank")).toBe(97450);
  });

  test("planned entries don't move balances until confirmed (BR-7)", () => {
    const accounts = [account("bank", "bank", 100000)];
    const rent = tx({ kind: "expense", amount: 1500000, is_planned: true });
    expect(accountBalances(accounts, [rent]).get("bank")).toBe(100000);
  });

  test("can be taken as of a moment", () => {
    const accounts = [account("bank", "bank", 100000)];
    const transactions = [
      tx({ kind: "expense", amount: 1000, occurred_at: "2026-09-01T10:00:00Z" }),
      tx({ kind: "expense", amount: 2000, occurred_at: "2026-09-20T10:00:00Z" }),
    ];
    const balances = accountBalances(accounts, transactions, new Date("2026-09-10T00:00:00Z"));
    expect(balances.get("bank")).toBe(99000);
  });
});

describe("balance summary", () => {
  test("splits money available, card dues and savings (FR-1, INS-18)", () => {
    const accounts = [
      account("bank", "bank"),
      account("wallet", "wallet"),
      account("card", "credit_card"),
      account("fd", "savings"),
    ];
    const balances = new Map([
      ["bank", 5000000],
      ["wallet", 50000],
      ["card", -1234567],
      ["fd", 2500000],
    ]);
    expect(balanceSummary(accounts, balances)).toEqual({
      available: 5050000,
      cardDues: 1234567,
      savings: 2500000,
      netPosition: 5050000 + 2500000 - 1234567,
    });
  });
});
