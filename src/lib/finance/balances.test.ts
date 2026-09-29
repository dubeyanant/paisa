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
      blocked: 0,
      cardDues: 1234567,
      cardCredit: 0,
      savings: 2500000,
      deposits: 0,
      loansOwed: 0,
      netPosition: 5050000 + 2500000 - 1234567,
      spendable: 5050000 - 1234567,
    });
  });

  test("blocked money counts as owned, but not as free to spend", () => {
    const accounts = [
      account("bank", "bank"),
      { ...account("blocked", "wallet"), is_blocked: true },
      { ...account("trip-fund", "wallet"), is_blocked: true },
      account("card", "credit_card"),
    ];
    const balances = new Map([
      ["bank", 11500000],
      ["blocked", 2500000],
      ["trip-fund", 1000000],
      ["card", -500000],
    ]);
    expect(balanceSummary(accounts, balances)).toMatchObject({
      available: 15000000,
      blocked: 3500000,
      cardDues: 500000,
      spendable: 15000000 - 3500000 - 500000,
      netPosition: 15000000 - 500000,
    });
  });

  test("adds up what's owed on each card, without netting a card in credit", () => {
    const accounts = [
      account("bank", "bank"),
      account("cashback", "credit_card"),
      account("travel", "credit_card"),
      account("shopping", "credit_card"),
    ];
    const balances = new Map([
      ["bank", 1000000],
      ["cashback", -395050],
      ["travel", 150000], // in credit
      ["shopping", -200000],
    ]);
    expect(balanceSummary(accounts, balances)).toMatchObject({
      cardDues: 395050 + 200000,
      cardCredit: 150000,
      netPosition: 1000000 + 150000 - 395050 - 200000,
    });
  });

  test("counts deposits as owned and loans as owed", () => {
    const accounts = [account("bank", "bank"), account("rent-deposit", "deposit"), account("loan", "loan")];
    const balances = new Map([
      ["bank", 1000000],
      ["rent-deposit", 3000000],
      ["loan", -20000000],
    ]);
    expect(balanceSummary(accounts, balances)).toMatchObject({
      available: 1000000,
      deposits: 3000000,
      loansOwed: 20000000,
      netPosition: 1000000 + 3000000 - 20000000,
    });
  });
});

describe("loan repayments", () => {
  test("move money from the bank to what's owed", () => {
    const accounts = [account("bank", "bank", 5000000), account("loan", "loan", -20000000)];
    const repayment = tx({ kind: "transfer", amount: 1500000, account_id: "bank", to_account_id: "loan" });
    const balances = accountBalances(accounts, [repayment]);
    expect(balances.get("bank")).toBe(3500000);
    expect(cardOutstanding(balances.get("loan")!)).toBe(18500000);
  });
});
