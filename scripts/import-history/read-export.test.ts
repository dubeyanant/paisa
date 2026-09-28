import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { cleanName, readExport, serialToMoment } from "./read-export";

// A made-up export in the old app's format (TD-6: never real data).
function workbook(rows: unknown[][]) {
  const header = ["Date", "Account", "Category", "Subcategory", "Note", "INR", "Income/Expense", "Description", "Amount", "Currency", "Account"];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), "Money Manager");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("serialToMoment", () => {
  test("reads spreadsheet dates as IST (FR-14 AC4)", () => {
    expect(serialToMoment(46286).toISOString()).toBe("2026-09-20T18:30:00.000Z"); // 21 Sep 2026, 00:00 IST
    // 2 Oct 2026, 23:12 IST (and a few seconds)
    expect(serialToMoment(46297.967082).toISOString()).toBe("2026-10-02T17:42:36.000Z");
  });
});

describe("cleanName", () => {
  test.each([
    ["🍜 Food", "Food"],
    ["Food", "Food"],
    ["律 Health", "Health"],
    ["  Snacks (Healthy) ", "Snacks (Healthy)"],
    ["Spent  for others", "Spent for others"],
  ])("%p -> %p (FR-14 AC5)", (input, expected) => {
    expect(cleanName(input)).toBe(expected);
  });
});

describe("readExport", () => {
  test("reads each row, with amounts in paise", () => {
    const { rows, unreadable } = readExport(
      workbook([
        [46286, "Main Bank", "🚗 Transport", "Rickshaw", "Station", 120, "Expense", "", 120, "INR", 120],
        [46286.5, "Main Bank", "Cashback CC", "", "Payment", 12345.67, "Transfer-Out", "", 12345.67, "INR", 12345.67],
      ]),
    );
    expect(unreadable).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, account: "Main Bank", category: "🚗 Transport", amount: 12000, type: "Expense" });
    expect(rows[1]).toMatchObject({ line: 3, category: "Cashback CC", amount: 1234567, type: "Transfer-Out" });
  });

  test("lists unreadable rows with the reason instead of dropping them", () => {
    const { rows, unreadable } = readExport(
      workbook([
        ["not a date", "Main Bank", "Food", "", "", 50, "Expense", ""],
        [46286, "Main Bank", "Food", "", "", "abc", "Expense", ""],
        [46286, "Main Bank", "Food", "", "", 50, "Borrowed", ""],
      ]),
    );
    expect(rows).toEqual([]);
    expect(unreadable.map((u) => u.line)).toEqual([2, 3, 4]);
  });

  test("rejects a file with different columns", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["When", "What"]]), "Sheet1");
    expect(() => readExport(XLSX.write(book, { type: "array", bookType: "xlsx" }))).toThrow(/Unexpected columns/);
  });
});
