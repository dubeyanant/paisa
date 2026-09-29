import { describe, expect, test } from "bun:test";
import { ordinal, parseAccountForm } from "./accounts";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const base = { name: "Main Bank", type: "bank", opening_balance: "10,000", opening_date: "2026-09-01" };

describe("parseAccountForm", () => {
  test("reads a bank account (FR-1 AC1)", () => {
    expect(parseAccountForm(form(base))).toEqual({
      ok: true,
      values: {
        name: "Main Bank",
        type: "bank",
        opening_balance: 1000000,
        opening_date: "2026-09-01",
        statement_day: null,
        due_day: null,
        is_emergency_fund: false,
      },
    });
  });

  test("stores what's owed on a card or loan as a negative balance", () => {
    const card = parseAccountForm(
      form({ ...base, type: "credit_card", opening_balance: "2,500.50", statement_day: "20", due_day: "5" }),
    );
    expect(card).toMatchObject({
      ok: true,
      values: { opening_balance: -250050, statement_day: 20, due_day: 5 },
    });

    const loan = parseAccountForm(form({ ...base, type: "loan", opening_balance: "4,50,000" }));
    expect(loan).toMatchObject({ ok: true, values: { opening_balance: -45000000 } });

    // A card in credit is entered as a negative amount owed.
    const inCredit = parseAccountForm(form({ ...base, type: "credit_card", opening_balance: "-300" }));
    expect(inCredit).toMatchObject({ ok: true, values: { opening_balance: 30000 } });
  });

  test("an empty opening balance is zero", () => {
    expect(parseAccountForm(form({ ...base, opening_balance: "" }))).toMatchObject({
      ok: true,
      values: { opening_balance: 0 },
    });
  });

  test("keeps card days and the emergency fund flag only where they apply", () => {
    const bank = parseAccountForm(form({ ...base, statement_day: "20", is_emergency_fund: "on" }));
    expect(bank).toMatchObject({ ok: true, values: { statement_day: null, is_emergency_fund: false } });

    const fund = parseAccountForm(form({ ...base, type: "savings", is_emergency_fund: "on" }));
    expect(fund).toMatchObject({ ok: true, values: { is_emergency_fund: true } });
  });

  test.each([
    ["no name", { name: "  " }, /name/],
    ["a long name", { name: "x".repeat(61) }, /60 characters/],
    ["an unknown type", { type: "crypto" }, /kind of account/],
    ["a bad amount", { opening_balance: "12.345" }, /amount/],
    ["a bad date", { opening_date: "2026-02-30" }, /date/],
    ["a bad due day", { type: "credit_card", due_day: "32" }, /1 to 31/],
  ])("rejects %s", (_label, fields, message) => {
    const result = parseAccountForm(form({ ...base, ...fields }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

test("ordinal", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
  ]);
});
