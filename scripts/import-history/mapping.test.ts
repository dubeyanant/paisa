import { describe, expect, test } from "bun:test";
import { applyMapping, importKeys, tagName, type Mapping } from "./mapping";
import { serialToMoment, type ExportRow } from "./read-export";

// Made-up rows and mapping (TD-6).
let line = 2;
function row(fields: Partial<ExportRow> & Pick<ExportRow, "type" | "category">): ExportRow {
  const serial = fields.serial ?? 46286.5;
  return {
    line: line++,
    serial,
    occurredAt: serialToMoment(serial),
    account: "Main Bank",
    subcategory: "",
    note: "",
    description: "",
    amount: 12000,
    ...fields,
  };
}

const mapping: Mapping = {
  accounts: {
    "Main Bank": { type: "bank" },
    "Cashback CC": { type: "credit_card" },
    "Old Fund": { name: "Mutual Fund", type: "savings" },
  },
  rules: [
    { type: "Expense", category: "Transport", subcategory: "Rikshaw", to: "Transport > Rickshaw" },
    { type: "Expense", category: "Other", subcategory: "Spent for others", note: /\b(mom|papa|family)\b/i, to: "Family & Giving > Family" },
    { type: "Expense", category: "Other", subcategory: "Spent for others", to: "Family & Giving > Friends & others" },
    { type: "Expense", category: "Investments", transferTo: "Old Fund" },
    { type: "Income", category: "Others", note: /balance adjustment/i, adjustment: true },
    { type: "Income", category: "Others", subcategory: "Refunds", refund: "Personal > Gadgets & personal items" },
    { type: "Income", category: "Salary", to: "Salary > Salary" },
    { type: "Expense", category: "Food", subcategory: "Test", skip: "made-up test rows" },
  ],
  tagNotes: /\btrip\b/i,
};
const NOW = new Date("2026-09-28T12:00:00Z");

describe("applyMapping", () => {
  test("maps by old category, ignoring emoji and case (FR-14 AC5)", () => {
    const { planned } = applyMapping([row({ type: "Expense", category: "🚗 transport", subcategory: "Rikshaw" })], mapping, NOW);
    expect(planned[0]).toMatchObject({ kind: "expense", subcategory: "Transport > Rickshaw", account: "Main Bank" });
  });

  test("imports a card payment as a transfer (FR-14 AC3)", () => {
    const payment = row({ type: "Transfer-Out", category: "Cashback CC", note: "Payment", amount: 1234567 });
    const { planned } = applyMapping([payment], mapping, NOW);
    expect(planned[0]).toMatchObject({ kind: "transfer", account: "Main Bank", toAccount: "Cashback CC", amount: 1234567 });
  });

  test("splits a category by note (FR-14 AC7)", () => {
    const { planned } = applyMapping(
      [
        row({ type: "Expense", category: "Other", subcategory: "Spent for others", note: "Sent to mom", amount: 800000 }),
        row({ type: "Expense", category: "Other", subcategory: "Spent for others", note: "Birthday contribution", amount: 20000 }),
      ],
      mapping,
      NOW,
    );
    expect(planned.map((p) => p.subcategory)).toEqual(["Family & Giving > Family", "Family & Giving > Friends & others"]);
  });

  test("turns rows into transfers, refunds and adjustments when the mapping says so", () => {
    const { planned } = applyMapping(
      [
        row({ type: "Expense", category: "Investments", subcategory: "Mutual Funds" }),
        row({ type: "Income", category: "Others", subcategory: "Refunds", note: "Blender" }),
        row({ type: "Income", category: "Others", subcategory: "", note: "Balance adjustment", amount: 500 }),
      ],
      mapping,
      NOW,
    );
    expect(planned[0]).toMatchObject({ kind: "transfer", toAccount: "Mutual Fund" });
    expect(planned[1]).toMatchObject({ kind: "refund", subcategory: "Personal > Gadgets & personal items" });
    expect(planned[2]).toMatchObject({ kind: "adjustment", amount: 500 });
  });

  test("marks future-dated rows as planned (FR-14 AC4)", () => {
    const future = row({ type: "Income", category: "Salary", serial: 46297.967082 });
    expect(applyMapping([future], mapping, NOW).planned[0].isPlanned).toBe(true);
    expect(applyMapping([future], mapping, new Date("2026-10-03T00:00:00Z")).planned[0].isPlanned).toBe(false);
  });

  test("turns trip notes into tags", () => {
    const { planned } = applyMapping([row({ type: "Expense", category: "Transport", subcategory: "Rikshaw", note: "hill station trip" })], mapping, NOW);
    expect(planned[0].tags).toEqual(["Hill Station Trip"]);
  });

  test("keeps the old names on every row", () => {
    const { planned } = applyMapping([row({ type: "Expense", category: "🚗 Transport", subcategory: "Rikshaw" })], mapping, NOW);
    expect(planned[0].importSource).toEqual({ account: "Main Bank", category: "🚗 Transport", subcategory: "Rikshaw", type: "Expense" });
  });

  test("reports what it can't map instead of guessing (FR-14 AC2)", () => {
    const result = applyMapping(
      [
        row({ type: "Expense", category: "Retired Category", subcategory: "Gone" }),
        row({ type: "Expense", category: "Transport", subcategory: "Rikshaw", account: "Mystery Wallet" }),
      ],
      mapping,
      NOW,
    );
    expect(result.unmapped.map((r) => r.category)).toEqual(["Retired Category"]);
    expect(result.unknownAccounts).toEqual(["Mystery Wallet"]);
  });

  test("lists skipped rows with a reason", () => {
    const { skipped, planned } = applyMapping(
      [
        row({ type: "Expense", category: "Food", subcategory: "Test" }),
        row({ type: "Expense", category: "Transport", subcategory: "Rikshaw", amount: 0 }),
        row({ type: "Transfer-In", category: "Main Bank", account: "Cashback CC" }),
      ],
      mapping,
      NOW,
    );
    expect(planned).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["made-up test rows", "zero amount", "Transfer-In mirrors a Transfer-Out"]);
  });
});

describe("importKeys", () => {
  test("are the same for the same row in a newer export (FR-14 AC6)", () => {
    const ride = row({ type: "Expense", category: "Transport", subcategory: "Rikshaw" });
    const other = row({ type: "Expense", category: "Transport", subcategory: "Rikshaw", amount: 5000 });
    expect(importKeys([ride])).toEqual(importKeys([{ ...ride, line: 99 }]));
    expect(importKeys([ride])[0]).not.toBe(importKeys([other])[0]);
  });

  test("tell identical rows in one file apart, so both import", () => {
    const ride = row({ type: "Expense", category: "Transport", subcategory: "Rikshaw" });
    const [first, second] = importKeys([ride, { ...ride }]);
    expect(first).not.toBe(second);
  });
});

describe("tagName", () => {
  test("gives one name to differently cased notes", () => {
    expect(tagName("badlapur  trip")).toBe("Badlapur Trip");
    expect(tagName("Badlapur Trip")).toBe("Badlapur Trip");
  });
});
