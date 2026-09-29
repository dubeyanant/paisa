import { describe, expect, test } from "bun:test";
import {
  addDays,
  fromIstDateTimeInput,
  toIstDateTimeInput,
  budgetMonthOf,
  istDate,
  istStartOf,
  periodContains,
  periodLength,
  shiftBudgetMonth,
  typicalMonthPeriods,
} from "./dates";

describe("IST dates (TD-9)", () => {
  test("a moment after IST midnight belongs to the IST day, not the UTC one", () => {
    // 00:30 IST on 1 Oct is still 30 Sep in UTC.
    expect(istDate("2026-09-30T19:00:00Z")).toBe("2026-10-01");
    expect(istDate("2026-09-30T18:29:59Z")).toBe("2026-09-30");
  });

  test("an IST day starts at 18:30 UTC the day before", () => {
    expect(istStartOf("2026-10-01").toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  test("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("budget months (FR-12)", () => {
  test("default to calendar months", () => {
    expect(budgetMonthOf("2026-09-28")).toEqual({ start: "2026-09-01", end: "2026-10-01" });
    expect(budgetMonthOf("2026-12-31")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  test("with start day 3, run from the 3rd to the 2nd (FR-12 AC1)", () => {
    expect(budgetMonthOf("2026-10-02", 3)).toEqual({ start: "2026-09-03", end: "2026-10-03" });
    expect(budgetMonthOf("2026-10-03", 3)).toEqual({ start: "2026-10-03", end: "2026-11-03" });
    expect(budgetMonthOf("2027-01-01", 3)).toEqual({ start: "2026-12-03", end: "2027-01-03" });
  });

  test("reject a start day that some months don't have", () => {
    expect(() => budgetMonthOf("2026-09-28", 31)).toThrow();
  });

  test("shift back and forth across years", () => {
    const sep = budgetMonthOf("2026-09-15");
    expect(shiftBudgetMonth(sep, -9)).toEqual({ start: "2025-12-01", end: "2026-01-01" });
    expect(shiftBudgetMonth(sep, 4)).toEqual({ start: "2027-01-01", end: "2027-02-01" });
  });

  test("contain moments by their IST date", () => {
    const oct = budgetMonthOf("2026-10-01");
    expect(periodContains(oct, "2026-09-30T19:00:00Z")).toBe(true); // 00:30 IST, 1 Oct
    expect(periodContains(oct, "2026-09-30T18:00:00Z")).toBe(false); // 23:30 IST, 30 Sep
    expect(periodContains(oct, "2026-10-31T18:29:59Z")).toBe(true);
    expect(periodContains(oct, "2026-10-31T18:30:00Z")).toBe(false);
  });

  test("know their length", () => {
    expect(periodLength(budgetMonthOf("2028-02-10"))).toBe(29);
  });
});

describe("typical month periods (BR-10)", () => {
  const oct = budgetMonthOf("2026-10-15");

  test("are the previous 3 complete months", () => {
    expect(typicalMonthPeriods(oct, "2024-01-01").map((p) => p.start)).toEqual([
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
    ]);
  });

  test("are fewer when history starts later", () => {
    expect(typicalMonthPeriods(oct, "2026-08-20").map((p) => p.start)).toEqual([
      "2026-09-01",
      "2026-08-01",
    ]);
  });

  test("are none without history", () => {
    expect(typicalMonthPeriods(oct, "2026-10-02")).toEqual([]);
    expect(typicalMonthPeriods(oct, null)).toEqual([]);
  });
});

describe("IST date-time inputs", () => {
  test("show a moment in IST", () => {
    expect(toIstDateTimeInput("2026-09-30T19:00:00Z")).toBe("2026-10-01T00:30");
  });

  test("read an IST value back as the same moment", () => {
    expect(fromIstDateTimeInput("2026-10-01T00:30")?.toISOString()).toBe("2026-09-30T19:00:00.000Z");
  });

  test.each(["", "2026-10-01", "2026-02-30T10:00", "2026-10-01T24:00", "garbage"])(
    "rejects %p",
    (value) => {
      expect(fromIstDateTimeInput(value)).toBeNull();
    },
  );
});
