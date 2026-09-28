import { describe, expect, test } from "bun:test";
import { budgetMonthOf } from "./dates";
import { account, byId, tx } from "./fixtures";
import { average, periodTotals, savingsRate, spendingBySubcategory } from "./totals";

const accounts = byId([
  account("bank", "bank"),
  account("card", "credit_card"),
  account("mf", "savings"),
  account("fd", "savings"),
]);
const sep = budgetMonthOf("2026-09-01");

describe("period totals", () => {
  test("card bill payments don't change spending (FR-3 AC1, UAT-4, BR-4)", () => {
    const spend = tx({ kind: "expense", amount: 50000, account_id: "card", subcategory_id: "food" });
    const payment = tx({ kind: "transfer", amount: 1234567, account_id: "bank", to_account_id: "card" });
    expect(periodTotals([spend], accounts, sep).spending).toBe(50000);
    expect(periodTotals([spend, payment], accounts, sep).spending).toBe(50000);
  });

  test("transfers into savings are invested, not spent (FR-3 AC2, UAT-5)", () => {
    const transactions = [
      tx({ kind: "transfer", amount: 1000000, account_id: "bank", to_account_id: "mf" }),
      tx({ kind: "transfer", amount: 2500000, account_id: "bank", to_account_id: "fd" }),
    ];
    expect(periodTotals(transactions, accounts, sep)).toEqual({
      income: 0,
      spending: 0,
      invested: 3500000,
      withdrawn: 0,
    });
  });

  test("savings → savings is neither invested nor withdrawn; savings → bank is withdrawn", () => {
    const transactions = [
      tx({ kind: "transfer", amount: 100000, account_id: "mf", to_account_id: "fd" }),
      tx({ kind: "transfer", amount: 40000, account_id: "fd", to_account_id: "bank" }),
    ];
    expect(periodTotals(transactions, accounts, sep)).toMatchObject({ invested: 0, withdrawn: 40000 });
  });

  test("deposits and loan repayments are neither spending nor saving", () => {
    const withMore = byId([...accounts.values(), account("rent-deposit", "deposit"), account("loan", "loan")]);
    const transactions = [
      tx({ kind: "transfer", amount: 3000000, account_id: "bank", to_account_id: "rent-deposit" }),
      tx({ kind: "transfer", amount: 1500000, account_id: "bank", to_account_id: "loan" }),
    ];
    expect(periodTotals(transactions, withMore, sep)).toEqual({
      income: 0,
      spending: 0,
      invested: 0,
      withdrawn: 0,
    });
  });

  test("refunds reduce spending (BR-6); adjustments count nowhere (BR-13)", () => {
    const transactions = [
      tx({ kind: "expense", amount: 200000, subcategory_id: "clothes" }),
      tx({ kind: "refund", amount: 80000, subcategory_id: "clothes" }),
      tx({ kind: "adjustment", amount: 999900 }),
    ];
    expect(periodTotals(transactions, accounts, sep)).toEqual({
      income: 0,
      spending: 120000,
      invested: 0,
      withdrawn: 0,
    });
  });

  test("a future rent entry counts in its own month once confirmed, never before (UAT-17)", () => {
    const rent = tx({ kind: "expense", amount: 1500000, occurred_at: "2026-10-05T04:30:00Z", is_planned: true });
    expect(periodTotals([rent], accounts, sep).spending).toBe(0);
    expect(periodTotals([rent], accounts, budgetMonthOf("2026-10-01")).spending).toBe(0);
    const confirmed = { ...rent, is_planned: false };
    expect(periodTotals([confirmed], accounts, sep).spending).toBe(0);
    expect(periodTotals([confirmed], accounts, budgetMonthOf("2026-10-01")).spending).toBe(1500000);
  });

  test("only counts the period's IST dates", () => {
    const lateNight = tx({ kind: "expense", amount: 12000, occurred_at: "2026-08-31T19:00:00Z" }); // 00:30 IST, 1 Sep
    const tooEarly = tx({ kind: "expense", amount: 5000, occurred_at: "2026-08-31T18:00:00Z" }); // 23:30 IST, 31 Aug
    expect(periodTotals([lateNight, tooEarly], accounts, sep).spending).toBe(12000);
  });
});

describe("spending by subcategory", () => {
  test("nets refunds and skips everything that isn't spending", () => {
    const transactions = [
      tx({ kind: "expense", amount: 12000, subcategory_id: "rickshaw" }),
      tx({ kind: "expense", amount: 15000, subcategory_id: "rickshaw" }),
      tx({ kind: "expense", amount: 30000, subcategory_id: "groceries" }),
      tx({ kind: "refund", amount: 5000, subcategory_id: "groceries" }),
      tx({ kind: "income", amount: 6000000, subcategory_id: "salary" }),
    ];
    expect(spendingBySubcategory(transactions, sep)).toEqual(
      new Map([
        ["rickshaw", 27000],
        ["groceries", 25000],
      ]),
    );
  });
});

describe("savings rate (BR-9)", () => {
  test("is (income − spending) ÷ income", () => {
    expect(savingsRate({ income: 6000000, spending: 4500000, invested: 0, withdrawn: 0 })).toBe(0.25);
  });

  test("is null without income", () => {
    expect(savingsRate({ income: 0, spending: 100, invested: 0, withdrawn: 0 })).toBeNull();
  });
});

describe("average (BR-10)", () => {
  test("rounds to the nearest paisa", () => {
    expect(average([100, 100, 101])).toBe(100);
    expect(average([100, 101])).toBe(101);
  });

  test("is null for no months", () => {
    expect(average([])).toBeNull();
  });
});
