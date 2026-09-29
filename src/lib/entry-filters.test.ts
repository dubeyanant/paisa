import { describe, expect, test } from "bun:test";
import {
  activeFilterCount,
  datePresets,
  describeRange,
  filtersQuery,
  parseFilters,
  searchArgs,
} from "./entry-filters";

const ID = "3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseFilters", () => {
  test("reads every filter", () => {
    expect(
      parseFilters({
        q: "  rickshaw ",
        from: "2026-03-01",
        to: "2026-03-31",
        account: ID,
        category: OTHER,
        bucket: ID,
        tag: OTHER,
        kind: "expense",
        min: "100",
        max: "1,250.50",
      }),
    ).toEqual({
      q: "rickshaw",
      from: "2026-03-01",
      to: "2026-03-31",
      account: ID,
      category: OTHER,
      bucket: ID,
      tag: OTHER,
      kind: "expense",
      min: 10000,
      max: 125050,
    });
  });

  test("drops anything malformed, so it never reaches the database", () => {
    expect(
      parseFilters({
        q: "   ",
        from: "yesterday",
        to: "2026-02-30",
        account: "1; drop table",
        kind: "gift",
        min: "-5",
        max: "12.345",
      }),
    ).toEqual({});
  });

  test("takes the first of repeated params", () => {
    expect(parseFilters({ kind: ["income", "expense"] })).toEqual({ kind: "income" });
  });

  test("puts reversed ranges the right way round", () => {
    expect(parseFilters({ from: "2026-03-31", to: "2026-03-01", min: "500", max: "5" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
      min: 500,
      max: 50000,
    });
  });

  test("a subcategory replaces its category", () => {
    expect(parseFilters({ category: ID, subcategory: OTHER })).toEqual({ subcategory: OTHER });
  });
});

test("filtersQuery round-trips through parseFilters", () => {
  const filters = parseFilters({ q: "50% off", from: "2026-03-01", subcategory: ID, kind: "refund", min: "99.5" });
  const query = filtersQuery(filters);
  expect(query).toBe(`q=50%25+off&from=2026-03-01&subcategory=${ID}&kind=refund&min=99.50`);
  expect(parseFilters(Object.fromEntries(new URLSearchParams(query)))).toEqual(filters);
  expect(filtersQuery({})).toBe("");
});

test("activeFilterCount counts a range once and leaves out the search text", () => {
  expect(activeFilterCount({})).toBe(0);
  expect(activeFilterCount({ q: "x", from: "2026-03-01", to: "2026-03-31", min: 0, max: 100 })).toBe(2);
  expect(activeFilterCount({ account: ID, subcategory: OTHER, bucket: ID, tag: ID, kind: "income" })).toBe(5);
});

describe("searchArgs", () => {
  test("turns IST days into moments, with the end day included", () => {
    expect(searchArgs({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      since: "2026-02-28T18:30:00.000Z",
      until: "2026-03-31T18:30:00.000Z",
    });
  });

  test("names the arguments as the SQL function does, leaving unset ones out", () => {
    expect(searchArgs({})).toEqual({});
    expect(searchArgs({ q: "auto", account: ID, subcategory: OTHER, tag: ID, kind: "transfer", min: 0, max: 500 })).toEqual({
      search: "auto",
      account: ID,
      subcategory: OTHER,
      tag: ID,
      kinds: ["transfer"],
      min_amount: 0,
      max_amount: 500,
    });
  });
});

describe("date presets", () => {
  test("cover this month, last month, 3 months and the calendar year", () => {
    expect(datePresets("2026-03-15").map(({ id, from, to }) => [id, from, to])).toEqual([
      ["this-month", "2026-03-01", "2026-03-31"],
      ["last-month", "2026-02-01", "2026-02-28"],
      ["3-months", "2026-01-01", "2026-03-31"],
      ["this-year", "2026-01-01", "2026-12-31"],
    ]);
    expect(datePresets("2026-01-10")[1]).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  test("describeRange names a preset, or the dates", () => {
    const today = "2026-03-15";
    expect(describeRange(undefined, undefined, today)).toBe("Any time");
    expect(describeRange("2026-02-01", "2026-02-28", today)).toBe("Last month");
    expect(describeRange("2026-03-01", "2026-03-15", today)).toBe("1 Mar – 15 Mar 2026");
    expect(describeRange("2025-12-20", "2026-01-05", today)).toBe("20 Dec 2025 – 5 Jan 2026");
    expect(describeRange("2026-03-02", "2026-03-02", today)).toBe("2 Mar 2026");
    expect(describeRange("2026-03-02", undefined, today)).toBe("From 2 Mar 2026");
    expect(describeRange(undefined, "2026-03-02", today)).toBe("Up to 2 Mar 2026");
  });
});
