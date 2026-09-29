import { describe, expect, test } from "bun:test";
import { parseName, parseTagDates, reorder, tagSuggested } from "./categories";

describe("parseName", () => {
  test("trims and squeezes spaces", () => {
    expect(parseName("  Eating   out ", "subcategory")).toEqual({ ok: true, name: "Eating out" });
  });

  test("needs 1 to 60 characters", () => {
    expect(parseName("   ", "category")).toEqual({ ok: false, error: "Give the category a name." });
    expect(parseName(undefined, "tag")).toEqual({ ok: false, error: "Give the tag a name." });
    expect(parseName("x".repeat(60), "tag").ok).toBe(true);
    expect(parseName("x".repeat(61), "tag").ok).toBe(false);
  });
});

describe("reorder", () => {
  test("swaps with the neighbour", () => {
    expect(reorder(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(reorder(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  test("can't move past either end, or move what isn't there", () => {
    expect(reorder(["a", "b"], "a", "up")).toBeNull();
    expect(reorder(["a", "b"], "b", "down")).toBeNull();
    expect(reorder(["a", "b"], "z", "up")).toBeNull();
  });
});

describe("parseTagDates", () => {
  test("dates are optional", () => {
    expect(parseTagDates("", undefined)).toEqual({ ok: true, dates: { starts_on: null, ends_on: null } });
  });

  test("one date is a one-day range", () => {
    expect(parseTagDates("2026-11-08", "")).toEqual({ ok: true, dates: { starts_on: "2026-11-08", ends_on: "2026-11-08" } });
    expect(parseTagDates("", "2026-11-08")).toEqual({ ok: true, dates: { starts_on: "2026-11-08", ends_on: "2026-11-08" } });
  });

  test("rejects unreal dates and backwards ranges", () => {
    expect(parseTagDates("2026-02-30", "").ok).toBe(false);
    expect(parseTagDates("soon", "").ok).toBe(false);
    expect(parseTagDates("2026-08-18", "2026-08-14")).toEqual({ ok: false, error: "The end date is before the start date." });
  });
});

test("tagSuggested only within a tag's dates, both days included", () => {
  const trip = { starts_on: "2026-08-14", ends_on: "2026-08-18" };
  expect(tagSuggested(trip, "2026-08-14")).toBe(true);
  expect(tagSuggested(trip, "2026-08-18")).toBe(true);
  expect(tagSuggested(trip, "2026-08-19")).toBe(false);
  expect(tagSuggested({ starts_on: null, ends_on: null }, "2026-08-15")).toBe(false);
});
