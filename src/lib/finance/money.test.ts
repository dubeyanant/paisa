import { describe, expect, test } from "bun:test";
import { formatINR, parseRupees, parseSignedRupees, toRupeesInput } from "./money";

describe("formatINR", () => {
  test("uses the ₹ sign and Indian grouping (BR-11)", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(1234567)).toBe("₹12,345.67");
    expect(formatINR(1234567890123)).toBe("₹12,34,56,78,901.23");
  });

  test("hides .00 on whole rupees unless asked", () => {
    expect(formatINR(3539900)).toBe("₹35,399");
    expect(formatINR(3539900, { paise: "always" })).toBe("₹35,399.00");
    expect(formatINR(0)).toBe("₹0");
  });

  test("keeps single paise exact", () => {
    expect(formatINR(1)).toBe("₹0.01");
    expect(formatINR(3000050)).toBe("₹30,000.50");
  });

  test("shows negatives with a minus sign", () => {
    expect(formatINR(-12050)).toBe("-₹120.50");
  });

  test("refuses anything that isn't whole paise", () => {
    expect(() => formatINR(12.5)).toThrow();
  });
});

describe("parseRupees", () => {
  test.each([
    ["120", 12000],
    ["120.5", 12050],
    ["120.50", 12050],
    ["0.01", 1],
    ["1,23,456.78", 12345678],
    ["₹ 99", 9900],
    ["12345.", 1234500],
  ])("%s is %i paise", (input, paise) => {
    expect(parseRupees(input)).toBe(paise);
  });

  test.each(["", "abc", "-5", "1.234", "1e3", ".5", "12.3.4"])("rejects %p", (input) => {
    expect(parseRupees(input)).toBeNull();
  });
});

describe("parseSignedRupees", () => {
  test.each([
    ["120.50", 12050],
    ["-120.50", -12050],
    [" -1,250 ", -125000],
    ["0", 0],
    ["-0", 0],
  ])("%s is %i paise", (input, paise) => {
    expect(parseSignedRupees(input)).toBe(paise);
  });

  test.each(["", "-", "--5", "5-", "abc"])("rejects %p", (input) => {
    expect(parseSignedRupees(input)).toBeNull();
  });
});

describe("toRupeesInput", () => {
  test.each([
    [1250000, "12500"],
    [12050, "120.50"],
    [1, "0.01"],
    [0, "0"],
    [-2500000, "-25000"],
  ])("%i paise is %p", (paise, text) => {
    expect(toRupeesInput(paise)).toBe(text);
    expect(parseSignedRupees(text)).toBe(paise);
  });
});
