import { describe, expect, test } from "bun:test";
import { describeEntry, istDayLabel, istTime } from "./describe-entry";

const accounts = new Map([
  ["bank", { name: "Main Bank", type: "bank" as const }],
  ["card", { name: "Cashback Card", type: "credit_card" as const }],
  ["loan", { name: "Education Loan", type: "loan" as const }],
]);
const subs = new Map([["rickshaw", { name: "Rickshaw" }]]);
const base = { amount: 12000, account_id: "bank", to_account_id: null, subcategory_id: "rickshaw", note: null };

describe("describeEntry", () => {
  test("an expense is named by its note, else its subcategory", () => {
    expect(describeEntry({ ...base, kind: "expense" }, accounts, subs)).toEqual({
      title: "Rickshaw",
      detail: "Main Bank",
      amount: -12000,
      direction: "out",
    });
    expect(describeEntry({ ...base, kind: "expense", note: "To office" }, accounts, subs)).toMatchObject({
      title: "To office",
      detail: "Rickshaw · Main Bank",
    });
  });

  test("a payment to a card or loan reads as one", () => {
    const pay = { ...base, kind: "transfer" as const, subcategory_id: null, to_account_id: "card" };
    expect(describeEntry(pay, accounts, subs)).toMatchObject({
      title: "Pay bill",
      detail: "Main Bank → Cashback Card",
      direction: "move",
    });
    expect(describeEntry({ ...pay, to_account_id: "loan" }, accounts, subs).title).toBe("Repay loan");
  });

  test("a refund adds money back", () => {
    expect(describeEntry({ ...base, kind: "refund" }, accounts, subs)).toMatchObject({
      detail: "Refund · Main Bank",
      amount: 12000,
      direction: "in",
    });
  });
});

describe("IST labels (TD-9)", () => {
  const now = new Date("2026-09-29T06:30:00Z"); // 12:00 IST, Tue 29 Sep

  test("names nearby days", () => {
    expect(istDayLabel("2026-09-28T19:00:00Z", now)).toBe("Today"); // 00:30 IST on the 29th
    expect(istDayLabel("2026-09-28T18:00:00Z", now)).toBe("Yesterday");
    expect(istDayLabel("2026-09-30T06:30:00Z", now)).toBe("Tomorrow");
    expect(istDayLabel("2026-09-26T06:30:00Z", now)).toBe("Sat, 26 Sept");
    expect(istDayLabel("2025-09-26T06:30:00Z", now)).toBe("26 Sept 2025");
  });

  test("shows the time in IST", () => {
    expect(istTime("2026-09-29T08:45:00Z")).toBe("2:15 pm");
  });
});
