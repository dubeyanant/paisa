import { describe, expect, test } from "bun:test";
import {
  defaultAccount,
  frequentSubcategories,
  noteMemory,
  parseEntry,
  quickPicks,
  transferLabel,
  type EntryInput,
  type RecentEntry,
} from "./entry";

// Made-up ids (TD-6).
const BANK = "00000000-0000-4000-8000-00000000000b";
const CARD = "00000000-0000-4000-8000-00000000000c";
const CASH = "00000000-0000-4000-8000-00000000000d";
const RICKSHAW = "00000000-0000-4000-8000-0000000000a1";
const MEALS = "00000000-0000-4000-8000-0000000000a2";
const SALARY = "00000000-0000-4000-8000-0000000000a3";
const LINE_1 = "00000000-0000-4000-8000-000000000101";
const LINE_2 = "00000000-0000-4000-8000-000000000102";

const usable = { accounts: new Set([BANK, CARD, CASH]), subcategories: new Set([RICKSHAW, MEALS, SALARY]) };

let minute = 0;
function entry(fields: Partial<RecentEntry>): RecentEntry {
  minute++;
  return {
    kind: "expense",
    amount: 12000,
    account_id: BANK,
    to_account_id: null,
    subcategory_id: RICKSHAW,
    note: null,
    // Newest first, as the lists come from the database.
    occurred_at: new Date(Date.UTC(2026, 8, 20) - minute * 60000).toISOString(),
    ...fields,
  };
}

describe("quickPicks", () => {
  test("offers a combination after three uses (FR-2 AC2)", () => {
    const two = [entry({}), entry({})];
    expect(quickPicks(two, usable)).toEqual([]);

    const three = [...two, entry({})];
    expect(quickPicks(three, usable)).toEqual([
      { kind: "expense", account_id: BANK, to_account_id: null, subcategory_id: RICKSHAW, note: null, amount: 12000, uses: 3 },
    ]);
  });

  test("uses the most common amount, the latest on a tie", () => {
    const recent = [entry({ amount: 15000 }), entry({ amount: 12000 }), entry({ amount: 12000 }), entry({ amount: 15000 })];
    expect(quickPicks(recent, usable)[0].amount).toBe(15000);
    recent.push(entry({ amount: 12000 }));
    expect(quickPicks(recent, usable)[0].amount).toBe(12000);
  });

  test("keeps notes and accounts apart, and ranks by uses", () => {
    const recent = [
      ...Array.from({ length: 3 }, () => entry({ subcategory_id: MEALS, note: "Lunch", amount: 15000 })),
      ...Array.from({ length: 4 }, () => entry({ subcategory_id: MEALS, note: " lunch ", amount: 15000 })),
      ...Array.from({ length: 3 }, () => entry({ subcategory_id: MEALS, note: "Dinner" })),
      ...Array.from({ length: 3 }, () => entry({ account_id: CASH })),
    ];
    const picks = quickPicks(recent, usable);
    expect(picks.map((p) => [p.note, p.uses])).toEqual([
      ["Lunch", 7], // "Lunch" and " lunch " are the same note
      ["Dinner", 3],
      [null, 3],
    ]);
    expect(picks[2].account_id).toBe(CASH);
  });

  test("skips archived accounts and hidden subcategories", () => {
    const recent = Array.from({ length: 3 }, () => entry({}));
    expect(quickPicks(recent, { ...usable, accounts: new Set([CARD]) })).toEqual([]);
    expect(quickPicks(recent, { ...usable, subcategories: new Set() })).toEqual([]);
  });

  test("offers bill payments too", () => {
    const recent = Array.from({ length: 3 }, () =>
      entry({ kind: "transfer", subcategory_id: null, to_account_id: CARD, amount: 500000 }),
    );
    expect(quickPicks(recent, usable)[0]).toMatchObject({ kind: "transfer", to_account_id: CARD });
  });
});

describe("defaultAccount", () => {
  test("is the account most used for expenses", () => {
    const recent = [entry({ account_id: CARD }), entry({}), entry({}), entry({ kind: "income", account_id: CASH, subcategory_id: SALARY })];
    expect(defaultAccount(recent, [CASH, BANK, CARD])).toBe(BANK);
  });

  test("falls back to the first active account", () => {
    expect(defaultAccount([], [CASH, BANK])).toBe(CASH);
    expect(defaultAccount([entry({})], [CASH])).toBe(CASH); // BANK is archived
    expect(defaultAccount([], [])).toBeNull();
  });
});

test("frequentSubcategories counts refunds as expense subcategories", () => {
  const recent = [entry({ subcategory_id: MEALS }), entry({ kind: "refund", subcategory_id: MEALS }), entry({}), entry({ kind: "income", subcategory_id: SALARY })];
  expect(frequentSubcategories(recent, "expense", usable)).toEqual([MEALS, RICKSHAW]);
  expect(frequentSubcategories(recent, "income", usable)).toEqual([SALARY]);
});

test("noteMemory remembers the latest subcategory for a note", () => {
  const recent = [entry({ note: "Auto", subcategory_id: RICKSHAW }), entry({ note: "auto", subcategory_id: MEALS })];
  expect(noteMemory(recent, usable).get("expense|auto")).toBe(RICKSHAW);
});

test("transferLabel", () => {
  expect(transferLabel("credit_card")).toBe("Pay bill");
  expect(transferLabel("loan")).toBe("Repay loan");
  expect(transferLabel("savings")).toBe("Transfer");
});

describe("parseEntry", () => {
  const now = new Date("2026-09-29T06:30:00Z"); // 12:00 IST
  const base: EntryInput = {
    kind: "expense",
    account_id: BANK,
    to_account_id: null,
    occurred_at: null,
    description: "",
    lines: [{ id: LINE_1, amount: "120", subcategory_id: RICKSHAW, note: "" }],
  };

  test("saves a rickshaw ride now (UAT-1)", () => {
    expect(parseEntry(base, now)).toEqual({
      ok: true,
      rows: [
        {
          id: LINE_1,
          kind: "expense",
          amount: 12000,
          account_id: BANK,
          to_account_id: null,
          subcategory_id: RICKSHAW,
          note: null,
          description: null,
          occurred_at: "2026-09-29T06:30:00.000Z",
          is_planned: false,
          bucket_override_id: null,
        },
      ],
      tagIds: [],
    });
  });

  test("takes tags for the whole entry, once each (FR-5)", () => {
    const TRIP = "00000000-0000-4000-8000-0000000000f1";
    expect(parseEntry({ ...base, tag_ids: [TRIP, TRIP] }, now)).toMatchObject({ ok: true, tagIds: [TRIP] });
    expect(parseEntry({ ...base, tag_ids: ["not-a-tag"] }, now).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i + 10)}`);
    expect(parseEntry({ ...base, tag_ids: many }, now)).toEqual({ ok: false, error: "Add at most 10 tags." });
  });

  test("gives every line the same date and time (FR-2 AC3)", () => {
    const result = parseEntry(
      {
        ...base,
        occurred_at: "2026-09-28T19:15",
        lines: [
          { id: LINE_1, amount: "300", subcategory_id: RICKSHAW, note: " Groceries " },
          { id: LINE_2, amount: "450.50", subcategory_id: MEALS, note: "" },
        ],
      },
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => [r.amount, r.note, r.occurred_at])).toEqual([
      [30000, "Groceries", "2026-09-28T13:45:00.000Z"],
      [45050, null, "2026-09-28T13:45:00.000Z"],
    ]);
  });

  test("a future date makes the entry planned (BR-7)", () => {
    const result = parseEntry({ ...base, occurred_at: "2026-10-01T09:00" }, now);
    expect(result).toMatchObject({ ok: true, rows: [{ is_planned: true }] });
  });

  test("an expense can go in another budget bucket; a transfer can't (FR-7 AC3)", () => {
    const WANTS = "00000000-0000-4000-8000-0000000000b2";
    expect(parseEntry({ ...base, bucket_override_id: WANTS }, now)).toMatchObject({
      ok: true,
      rows: [{ bucket_override_id: WANTS }],
    });
    const transfer = parseEntry({ ...base, kind: "transfer", to_account_id: CARD, bucket_override_id: WANTS }, now);
    expect(transfer).toMatchObject({ ok: true, rows: [{ bucket_override_id: null }] });
    expect(parseEntry({ ...base, bucket_override_id: "nope" }, now).ok).toBe(false);
  });

  test("a transfer has no category, and a card payment is one (FR-3 AC1)", () => {
    const result = parseEntry(
      { ...base, kind: "transfer", to_account_id: CARD, lines: [{ id: LINE_1, amount: "12,345.67", subcategory_id: RICKSHAW, note: "" }] },
      now,
    );
    expect(result).toMatchObject({ ok: true, rows: [{ kind: "transfer", amount: 1234567, to_account_id: CARD, subcategory_id: null }] });
  });

  test.each([
    ["no amount", { lines: [{ id: LINE_1, amount: "", subcategory_id: RICKSHAW, note: "" }] }, /amount/],
    ["a zero amount", { lines: [{ id: LINE_1, amount: "0", subcategory_id: RICKSHAW, note: "" }] }, /amount/],
    ["no category", { lines: [{ id: LINE_1, amount: "120", subcategory_id: null, note: "" }] }, /category/],
    [
      "a line without a category",
      { lines: [{ id: LINE_1, amount: "120", subcategory_id: RICKSHAW, note: "" }, { id: LINE_2, amount: "5", subcategory_id: null, note: "" }] },
      /category on line 2/,
    ],
    ["no account", { account_id: "" }, /account/],
    ["a transfer to the same account", { kind: "transfer" as const, to_account_id: BANK }, /different/],
    ["a transfer with no destination", { kind: "transfer" as const }, /goes to/],
    ["a bad date", { occurred_at: "2026-02-30T10:00" }, /date/],
    ["a bad line id", { lines: [{ id: "x", amount: "120", subcategory_id: RICKSHAW, note: "" }] }, /Reload/],
  ])("rejects %s", (_label, fields, message) => {
    const result = parseEntry({ ...base, ...fields }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});
