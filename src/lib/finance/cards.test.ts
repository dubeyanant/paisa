import { describe, expect, test } from "bun:test";
import { cardOverview, lastStatementDate, statementDueDate } from "./cards";
import { budgetMonthOf } from "./dates";
import { account, at, tx } from "./fixtures";

describe("statement dates", () => {
  test("the last statement on or before today, and the due day after it", () => {
    expect(lastStatementDate(18, "2026-09-18")).toBe("2026-09-18");
    expect(lastStatementDate(18, "2026-09-17")).toBe("2026-08-18");
    expect(lastStatementDate(31, "2026-10-05")).toBe("2026-09-30");
    expect(statementDueDate("2026-09-18", 5)).toBe("2026-10-05");
    expect(statementDueDate("2026-09-02", 20)).toBe("2026-09-20");
  });
});

describe("INS-11 credit card overview", () => {
  const card = { ...account("card", "credit_card"), statement_day: 18, due_day: 5 };
  const sep = budgetMonthOf("2026-09-01");

  test("₹12,345.67 due in 6 days, with an effective cashback of 2.5%", () => {
    const transactions = [
      tx({ kind: "expense", amount: 1234567, account_id: "card", subcategory_id: "x", occurred_at: at("2026-09-10") }),
      tx({ kind: "expense", amount: 1765433, account_id: "card", subcategory_id: "x", occurred_at: at("2026-09-20") }),
      tx({ kind: "income", amount: 75000, account_id: "card", subcategory_id: "cashback", occurred_at: at("2026-09-22") }),
    ];
    const result = cardOverview(card, transactions, new Set(["cashback"]), sep, "2026-09-29");
    expect(result.outstanding).toBe(1234567 + 1765433 - 75000);
    expect(result.statement).toEqual({
      date: "2026-09-18",
      amount: 1234567,
      // The cashback credited since the statement counts toward it.
      due: 1234567 - 75000,
      dueOn: "2026-10-05",
      daysToDue: 6,
    });
    expect(result).toMatchObject({ cashbackMonth: 75000, cashbackYear: 75000, spendYear: 3000000, effectiveRate: 0.025 });
  });

  test("paying the bill clears what's due", () => {
    const transactions = [
      tx({ kind: "expense", amount: 1234567, account_id: "card", subcategory_id: "x", occurred_at: at("2026-09-10") }),
      tx({ kind: "transfer", amount: 1234567, to_account_id: "card", occurred_at: at("2026-09-25") }),
    ];
    const result = cardOverview(card, transactions, new Set(), sep, "2026-09-29");
    expect(result.outstanding).toBe(0);
    expect(result.statement?.due).toBe(0);
  });

  test("a card without statement and due days has no statement", () => {
    expect(cardOverview(account("card", "credit_card"), [], new Set(), sep, "2026-09-29").statement).toBeNull();
  });
});
