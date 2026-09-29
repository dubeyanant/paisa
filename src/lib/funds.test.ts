import { describe, expect, test } from "bun:test";
import { budgetMonthOf, istStartOf } from "@/lib/finance/dates";
import { at } from "@/lib/finance/fixtures";
import { fundState, type Fund } from "@/lib/finance/funds";
import { fundChange, fundDetail, fundHeld, goalPreview, monthChoices, monthName, parseFundChange, parseNewFund, type FundInput } from "./funds";

// Made-up funds (TD-6).
const october = budgetMonthOf("2026-10-15");
const blank: FundInput = {
  name: "New phone",
  kind: "goal",
  bucket_id: null,
  target: "60,000",
  monthly_amount: "",
  cap: "",
  from_month: "2026-10-01",
  to_month: "2027-01-01",
  put_in: "",
};
const phone: Fund = {
  id: "phone",
  kind: "goal",
  bucket_id: null,
  target: 6000000,
  monthly_amount: null,
  cap: null,
  schedule_from: "2026-10-01",
  ends_on: "2027-01-01",
  closed_at: null,
};

describe("a new fund", () => {
  test("a goal needs a target and its months, from this month on", () => {
    expect(parseNewFund(blank, october)).toEqual({
      ok: true,
      putIn: 0,
      row: {
        name: "New phone",
        kind: "goal",
        bucket_id: null,
        target: 6000000,
        monthly_amount: null,
        cap: null,
        schedule_from: "2026-10-01",
        ends_on: "2027-01-01",
      },
    });
    expect(parseNewFund({ ...blank, target: "" }, october)).toMatchObject({ ok: false });
    expect(parseNewFund({ ...blank, from_month: "2026-09-01" }, october)).toEqual({ ok: false, error: "Start saving this month or later." });
    expect(parseNewFund({ ...blank, to_month: "2026-09-01" }, october)).toEqual({ ok: false, error: "The last month is before the first." });
  });

  test("an ongoing fund starts this month, with an optional monthly amount, cap and money put in now", () => {
    const clothes = { ...blank, name: "Clothes", kind: "ongoing" as const, target: "", monthly_amount: "2,000", cap: "5000", put_in: "1,500" };
    expect(parseNewFund(clothes, october)).toMatchObject({
      ok: true,
      putIn: 150000,
      row: { kind: "ongoing", target: null, monthly_amount: 200000, cap: 500000, schedule_from: "2026-10-01", ends_on: null },
    });
    expect(parseNewFund({ ...clothes, monthly_amount: "", cap: "" }, october)).toMatchObject({
      ok: true,
      row: { monthly_amount: null, cap: null },
    });
    expect(parseNewFund({ ...clothes, cap: "lots" }, october)).toMatchObject({ ok: false });
    expect(parseNewFund({ ...clothes, name: " " }, october)).toEqual({ ok: false, error: "Give the fund a name." });
  });
});

describe("changing a fund", () => {
  test("a goal that has started keeps its start, and can't end in the past", () => {
    const december = budgetMonthOf("2026-12-10");
    expect(parseFundChange(phone, { ...blank, from_month: "2026-12-01", to_month: "2027-03-01" }, december, 1)).toMatchObject({
      ok: true,
      row: { schedule_from: "2026-10-01", ends_on: "2027-03-01" },
    });
    expect(parseFundChange(phone, { ...blank, to_month: "2026-11-01" }, december, 1)).toEqual({
      ok: false,
      error: "The last month can't be in the past.",
    });
    // Once its months are over, it can still be renamed.
    const ended = { ...phone, ends_on: "2026-11-01" };
    expect(parseFundChange(ended, { ...blank, name: "Phone", to_month: "2026-11-01" }, december, 1)).toMatchObject({ ok: true });
    expect(parseFundChange(ended, { ...blank, target: "70,000", to_month: "2026-11-01" }, december, 1)).toMatchObject({ ok: false });
  });

  test("a goal that hasn't started can move its start", () => {
    const later = { ...phone, schedule_from: "2026-12-01" };
    expect(parseFundChange(later, { ...blank, from_month: "2026-11-01" }, october, 1)).toMatchObject({
      ok: true,
      row: { schedule_from: "2026-11-01" },
    });
  });

  test("a new schedule keeps the finished months and runs from this month; a new name alone keeps everything", () => {
    const now = new Date(at("2026-12-10"));
    const december = budgetMonthOf("2026-12-10");
    const state = fundState(phone, [], [], 1, now);
    const bigger = parseFundChange(phone, { ...blank, target: "90,000" }, december, 1);
    if (!bigger.ok) throw new Error(bigger.error);
    expect(fundChange(state, bigger.row, december, 1)).toEqual({
      row: { ...bigger.row, schedule_from: "2026-12-01" },
      kept: [
        { amount: 1500000, occurred_at: istStartOf("2026-10-01").toISOString() },
        { amount: 1500000, occurred_at: istStartOf("2026-11-01").toISOString() },
      ],
    });
    const renamed = parseFundChange(phone, { ...blank, name: "Phone" }, december, 1);
    if (!renamed.ok) throw new Error(renamed.error);
    expect(fundChange(state, renamed.row, december, 1)).toEqual({ row: renamed.row, kept: [] });
  });
});

test("goalPreview works out the shares as the schedule does", () => {
  // ₹60,000 over 4 months, ₹5,000 put in after this month's share.
  expect(goalPreview(6000000, 0, 500000, 4)).toEqual({ first: 1500000, then: 1333400 });
  const s = fundState(phone, [{ fund_id: "phone", amount: 500000, occurred_at: at("2026-10-05"), is_monthly: false }], [], 1, new Date(at("2026-11-02")));
  expect(s.events.filter((e) => e.type === "monthly").map((e) => e.amount)).toEqual([1500000, 1333400]);
  expect(goalPreview(6000000, 0, 0, 1)).toEqual({ first: 6000000, then: null });
  expect(goalPreview(6000000, 7000000, 0, 3)).toEqual({ first: 0, then: 0 });
});

describe("words", () => {
  test("month names, with the year when months don't start on the 1st", () => {
    expect(monthName(october)).toBe("October 2026");
    expect(monthName(budgetMonthOf("2026-10-25", 21))).toBe("21 Oct – 20 Nov 2026");
    expect(monthChoices(october, 3).map((c) => c.value)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });

  test("where a fund stands", () => {
    const state = fundState(phone, [], [], 1, new Date(at("2026-11-10")));
    expect(fundDetail(state, 1)).toBe("₹15,000 this month · 3 months left");
    expect(fundHeld(state)).toBe("₹30,000 of ₹60,000");
    const clothes: Fund = { ...phone, kind: "ongoing", target: null, ends_on: null, monthly_amount: 200000, cap: 500000 };
    expect(fundDetail(fundState(clothes, [], [], 1, new Date(at("2026-11-10"))), 1)).toBe("₹2,000 a month, up to ₹5,000");
  });
});
