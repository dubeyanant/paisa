import { describe, expect, test } from "bun:test";
import { at, tx } from "./fixtures";
import { tagReports } from "./tags";

const categoryOf = new Map([
  ["stay", "trips"],
  ["activities", "trips"],
  ["eating-out", "food"],
]);

describe("INS-13 tag and trip reports", () => {
  test("12 transactions over 6 days: total, per day and breakdown (UAT-9, FR-5 AC1)", () => {
    const days = ["01", "02", "03", "04", "05", "06"];
    const trip = days.flatMap((d) => [
      tx({ kind: "expense", amount: 120000, subcategory_id: "activities", occurred_at: at(`2026-03-${d}`) }),
      tx({ kind: "expense", amount: 180000, subcategory_id: "eating-out", occurred_at: at(`2026-03-${d}`) }),
    ]);
    const untagged = tx({ kind: "expense", amount: 99900, subcategory_id: "eating-out", occurred_at: at("2026-03-03") });
    const tagsByTransaction = new Map(trip.map((t) => [t.id, ["goa"]]));

    const [report] = tagReports([...trip, untagged], tagsByTransaction, [{ id: "goa", starts_on: null, ends_on: null }], categoryOf);
    expect(report).toMatchObject({ count: 12, total: 1800000, days: 6, perDay: 300000, vsOthers: null });
    expect(report.byCategory).toEqual(new Map([["trips", 720000], ["food", 1080000]]));
  });

  test("uses the tag's own dates, nets off refunds and compares with other trips", () => {
    const a = tx({ kind: "expense", amount: 400000, subcategory_id: "stay", occurred_at: at("2026-04-02") });
    const refund = tx({ kind: "refund", amount: 100000, subcategory_id: "stay", occurred_at: at("2026-04-03") });
    const b = tx({ kind: "expense", amount: 150000, subcategory_id: "stay", occurred_at: at("2026-05-02") });
    const tags = [
      { id: "hills", starts_on: "2026-04-01", ends_on: "2026-04-03" },
      { id: "beach", starts_on: null, ends_on: null },
    ];
    const reports = tagReports(
      [a, refund, b],
      new Map([[a.id, ["hills"]], [refund.id, ["hills"]], [b.id, ["beach"]]]),
      tags,
      categoryOf,
    );
    expect(reports.map((r) => [r.tagId, r.total, r.days, r.perDay, r.vsOthers])).toEqual([
      ["beach", 150000, 1, 150000, 1.5],
      ["hills", 300000, 3, 100000, 100000 / 150000],
    ]);
  });
});
