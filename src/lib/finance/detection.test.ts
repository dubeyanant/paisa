import { describe, expect, test } from "bun:test";
import { detectRecurring, noteKey, priceChange, recurringPayments } from "./detection";
import { at, commitment, tx } from "./fixtures";
import type { Transaction } from "./types";

function monthly(subcategory_id: string, note: string, amounts: number[], day = "10"): Transaction[] {
  return amounts.map((amount, i) =>
    tx({
      kind: "expense",
      amount,
      subcategory_id,
      note,
      occurred_at: at(`2026-${String(i + 4).padStart(2, "0")}-${day}`),
    }),
  );
}

describe("detecting recurring payments (FR-6)", () => {
  test("finds a monthly payment and when it's next due", () => {
    const gym = monthly("gym", "Gym Sep", [250000, 250000, 250000]);
    const [found] = detectRecurring(gym, [], "2026-06-20");
    expect(found).toMatchObject({ unit: "month", every: 1, amount: 250000, next_due_on: "2026-07-10" });
    expect(found.payments).toHaveLength(3);
  });

  test("ignores irregular spending, even under one note", () => {
    const days = ["2026-06-01", "2026-06-03", "2026-06-04", "2026-06-12", "2026-06-13"];
    const rides = days.map((d) =>
      tx({ kind: "expense", amount: 12000, subcategory_id: "rickshaw", note: "rick", occurred_at: at(d) }),
    );
    expect(detectRecurring(rides, [], "2026-06-20", 2)).toEqual([]);
  });

  test("ignores a series that stopped, or whose amounts jump", () => {
    expect(detectRecurring(monthly("gym", "gym", [250000, 250000, 250000]), [], "2026-09-01")).toEqual([]);
    expect(detectRecurring(monthly("misc", "shop", [10000, 50000, 10000]), [], "2026-06-20")).toEqual([]);
  });

  test("leaves out what a commitment already covers, and payments linked to one", () => {
    const gym = monthly("gym", "gym", [250000, 250000, 250000]);
    expect(detectRecurring(gym, [commitment({ id: "c", subcategory_id: "gym", amount: 250000 })], "2026-06-20")).toEqual([]);
    const linked = gym.map((t) => ({ ...t, recurring_id: "c" }));
    expect(detectRecurring(linked, [], "2026-06-20")).toEqual([]);
  });

  test("finds monthly transfers, such as a SIP", () => {
    const sip = [4, 5, 6].map((m) =>
      tx({ kind: "transfer", amount: 500000, to_account_id: "mf", occurred_at: at(`2026-0${m}-07`) }),
    );
    expect(detectRecurring(sip, [], "2026-06-20")).toMatchObject([{ kind: "transfer", to_account_id: "mf" }]);
  });

  test("notes match regardless of case, digits and month names", () => {
    expect(noteKey("Rent - Sep 2026")).toBe(noteKey("rent oct"));
  });
});

describe("price changes (INS-09)", () => {
  test("streaming at ₹149 then ₹199 is flagged (UAT-8)", () => {
    const streaming = monthly("subscriptions", "streaming", [14900, 19900]);
    const [payment] = recurringPayments([], streaming, "2026-05-20");
    expect(payment.priceChange).toEqual({ from: 14900, to: 19900, on: "2026-05-10" });
    expect(payment.yearly).toBe(238800);
  });

  test("a change under 1% isn't flagged", () => {
    const charges = monthly("x", "x", [100000, 100999]);
    expect(priceChange(charges, false)).toBeNull();
    expect(priceChange(monthly("x", "x", [100000, 101000]), false)).not.toBeNull();
  });

  test("a variable bill is flagged only after a run of equal charges", () => {
    expect(priceChange(monthly("e", "e", [90000, 110000, 125000]), true)).toBeNull();
    expect(priceChange(monthly("e", "e", [14900, 14900, 19900]), true)).not.toBeNull();
  });

  test("a defined commitment uses its linked payments", () => {
    const c = commitment({ id: "streaming", amount: 14900 });
    const charges = monthly("streaming", "", [14900, 19900]).map((t) => ({ ...t, recurring_id: "streaming" }));
    const [payment] = recurringPayments([c], charges, "2026-05-20");
    expect(payment.commitment).toBe(c);
    expect(payment.amount).toBe(19900);
    expect(payment.priceChange).toMatchObject({ from: 14900, to: 19900 });
  });
});
