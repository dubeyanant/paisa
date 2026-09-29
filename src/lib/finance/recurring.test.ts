import { describe, expect, test } from "bun:test";
import { budgetMonthOf } from "./dates";
import { account, at, byId, commitment, tx } from "./fixtures";
import {
  addMonths,
  committedIn,
  dueDates,
  paymentsByCommitment,
  pendingDues,
  plannedToPay,
  recurringCost,
  reservedIn,
  upcoming,
} from "./recurring";

const rent = commitment({ id: "rent", amount: 1500000, first_due_on: "2026-07-05" });

describe("due dates", () => {
  test("a day missing from a month falls on its last day, and comes back after", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    const c = commitment({ id: "x", amount: 100, first_due_on: "2026-01-31" });
    expect(dueDates(c, "2026-05-01")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  test("weekly, every 3 months, yearly", () => {
    const weekly = commitment({ id: "w", amount: 100, unit: "week", first_due_on: "2026-09-01" });
    expect(dueDates(weekly, "2026-09-20")).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
    const quarterly = commitment({ id: "q", amount: 100, every: 3, first_due_on: "2026-01-15" });
    expect(dueDates(quarterly, "2027-01-01")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
    const yearly = commitment({ id: "y", amount: 100, unit: "year", first_due_on: "2028-02-29" });
    expect(dueDates(yearly, "2030-01-01")).toEqual(["2028-02-29", "2029-02-28"]);
  });

  test("stop at ends_on, and a paused commitment has none", () => {
    expect(dueDates({ ...rent, ends_on: "2026-08-31" }, "2027-01-01")).toEqual(["2026-07-05", "2026-08-05"]);
    expect(dueDates({ ...rent, paused_at: "2026-08-01T00:00:00Z" }, "2027-01-01")).toEqual([]);
  });
});

describe("pending entries (FR-6 AC1)", () => {
  test("rent due on the 5th is pending on the 5th, not on the 4th", () => {
    const paid = [tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-07-05") })];
    const payments = paymentsByCommitment(paid);
    expect(pendingDues([rent], payments, "2026-08-04")).toEqual([]);
    expect(pendingDues([rent], payments, "2026-08-05").map((d) => d.due_on)).toEqual(["2026-08-05"]);
  });

  test("payments cover due dates in order, early or late", () => {
    const paid = [
      tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-07-09") }),
      tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-08-02") }),
    ];
    expect(pendingDues([rent], paymentsByCommitment(paid), "2026-08-20")).toEqual([]);
  });

  test("a skipped due date isn't pending, and payments cover the dates around it", () => {
    const skipped = { ...rent, skipped_on: ["2026-08-05"] };
    const paid = [tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-07-05") })];
    const payments = paymentsByCommitment(paid);
    expect(pendingDues([skipped], payments, "2026-09-10").map((d) => d.due_on)).toEqual(["2026-09-05"]);
    expect(dueDates(skipped, "2026-10-01")).toEqual(["2026-07-05", "2026-09-05"]);
  });
});

describe("committed and reserved", () => {
  const sep = budgetMonthOf("2026-09-01");
  const electricity = commitment({
    id: "electricity",
    amount: 90000,
    is_variable: true,
    first_due_on: "2026-09-20",
  });

  test("on the 1st, reserved is every commitment due this month (FR-6 AC2)", () => {
    const septemberRent = { ...rent, first_due_on: "2026-09-05" };
    expect(reservedIn([septemberRent, electricity], [], sep, "2026-09-01")).toBe(1590000);
    expect(committedIn([septemberRent, electricity], new Map(), sep)).toBe(1590000);
  });

  test("unpaid due dates from earlier months stay reserved", () => {
    expect(reservedIn([rent], [], sep, "2026-09-01")).toBe(4500000);
  });

  test("a skipped due date isn't reserved or committed", () => {
    const skipped = { ...rent, skipped_on: ["2026-08-05", "2026-09-05"] };
    expect(reservedIn([skipped], [], sep, "2026-09-01")).toBe(1500000);
    expect(committedIn([skipped], new Map(), sep)).toBe(0);
  });

  test("a paid variable bill counts at what was paid (FR-6 AC3)", () => {
    const paid = [
      tx({ kind: "expense", amount: 120000, recurring_id: "electricity", occurred_at: at("2026-09-21") }),
    ];
    expect(committedIn([electricity], paymentsByCommitment(paid), sep)).toBe(120000);
    expect(reservedIn([electricity], paid, sep, "2026-09-22")).toBe(0);
  });

  test("planned entries are reserved and upcoming; next month's aren't reserved yet (UAT-17)", () => {
    const planned = tx({ kind: "expense", amount: 1500000, is_planned: true, occurred_at: at("2026-10-05") });
    expect(reservedIn([], [planned], sep, "2026-09-10")).toBe(0);
    expect(upcoming([], [planned], "2026-09-10").total).toBe(1500000);
  });

  test("a planned entry linked to a due date shows once", () => {
    const planned = tx({
      kind: "expense",
      amount: 1500000,
      is_planned: true,
      recurring_id: "rent",
      occurred_at: at("2026-09-05"),
    });
    const earlier = [7, 8].map((m) =>
      tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at(`2026-0${m}-05`) }),
    );
    const { items, total } = upcoming([rent], [...earlier, planned], "2026-09-10");
    expect(items.map((i) => [i.date, i.transaction_id])).toEqual([
      ["2026-09-05", planned.id],
      ["2026-10-05", null],
    ]);
    expect(total).toBe(3000000);
  });

  test("unpaid past due dates are overdue", () => {
    const { items } = upcoming([rent], [], "2026-07-10", 30);
    expect(items.map((i) => [i.date, i.overdue])).toEqual([
      ["2026-07-05", true],
      ["2026-08-05", false],
    ]);
  });
});

test("monthly and yearly cost (INS-09)", () => {
  expect(recurringCost(19900, { unit: "month", every: 1 })).toEqual({ monthly: 19900, yearly: 238800 });
  expect(recurringCost(120000, { unit: "year", every: 1 })).toEqual({ monthly: 10000, yearly: 120000 });
  expect(recurringCost(50000, { unit: "week", every: 1 })).toEqual({ monthly: 216667, yearly: 2600000 });
});

describe("planned money to pay this month (TD-18)", () => {
  // Budget months start on the 21st.
  const month = budgetMonthOf("2026-09-29", 21);
  const accounts = byId([
    account("bank", "bank"),
    { ...account("trip-fund", "wallet"), is_blocked: true },
    account("cash", "wallet"),
    account("card", "credit_card"),
    account("index", "savings"),
    account("loan", "loan"),
  ]);
  const rent = commitment({ id: "rent", amount: 1500000, first_due_on: "2026-10-01" });
  const family = commitment({ id: "family", amount: 1000000, first_due_on: "2026-09-30" });
  const sip = commitment({
    id: "sip",
    kind: "transfer",
    amount: 500000,
    subcategory_id: null,
    to_account_id: "index",
    first_due_on: "2026-10-05",
  });

  test("counts bills and savings still to pay up to the month's end, overdue included", () => {
    const lateBill = commitment({ id: "late", amount: 90000, first_due_on: "2026-09-25" });
    // 1 Oct rent, 30 Sep family, 5 Oct SIP, 25 Sep bill; next due dates fall after 20 Oct.
    expect(plannedToPay([rent, family, sip, lateBill], [], accounts, month, "2026-09-29")).toBe(
      1500000 + 1000000 + 500000 + 90000,
    );
    const paid = tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-10-01") });
    expect(plannedToPay([rent], [paid], accounts, month, "2026-10-02")).toBe(0);
  });

  test("leaves out what doesn't come from money available to spend", () => {
    const cardBill = commitment({ id: "cb", kind: "transfer", amount: 800000, subcategory_id: null, to_account_id: "card", first_due_on: "2026-10-05" });
    const toCash = commitment({ id: "atm", kind: "transfer", amount: 200000, subcategory_id: null, to_account_id: "cash", first_due_on: "2026-10-05" });
    const fromFund = commitment({ id: "trip", amount: 300000, account_id: "trip-fund", first_due_on: "2026-10-05" });
    const emi = commitment({ id: "emi", kind: "transfer", amount: 400000, subcategory_id: null, to_account_id: "loan", first_due_on: "2026-10-05" });
    const onCard = commitment({ id: "ott", amount: 19900, account_id: "card", first_due_on: "2026-10-05" });
    expect(plannedToPay([cardBill, toCash, fromFund, emi, onCard], [], accounts, month, "2026-09-29")).toBe(400000 + 19900);
  });

  test("one-off planned entries count too, until the month's end", () => {
    const soon = tx({ kind: "expense", amount: 250000, is_planned: true, occurred_at: at("2026-10-10") });
    const nextMonth = tx({ kind: "expense", amount: 250000, is_planned: true, occurred_at: at("2026-10-21") });
    expect(plannedToPay([], [soon, nextMonth], accounts, month, "2026-09-29")).toBe(250000);
  });
});
