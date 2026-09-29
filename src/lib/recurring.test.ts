import { describe, expect, test } from "bun:test";
import { at, commitment, tx } from "@/lib/finance/fixtures";
import {
  confirmedAt,
  dayInSentence,
  describeSchedule,
  isScheduledOn,
  parseCommitment,
  recurringOverview,
  type CommitmentInput,
} from "./recurring";

const BANK = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const RENT = "33333333-3333-4333-8333-333333333333";

const input: CommitmentInput = {
  name: "  Room rent ",
  kind: "expense",
  amount: "15,000",
  is_variable: false,
  account_id: BANK,
  to_account_id: CARD,
  subcategory_id: RENT,
  unit: "month",
  every: 1,
  first_due_on: "2026-10-05",
  ends_on: "",
};

describe("parseCommitment", () => {
  test("an expense keeps its category and drops the other account", () => {
    const parsed = parseCommitment(input);
    expect(parsed).toEqual({
      ok: true,
      row: {
        name: "Room rent",
        kind: "expense",
        amount: 1500000,
        is_variable: false,
        account_id: BANK,
        to_account_id: null,
        subcategory_id: RENT,
        unit: "month",
        every: 1,
        first_due_on: "2026-10-05",
        ends_on: null,
      },
    });
  });

  test("a transfer keeps both accounts and no category", () => {
    const parsed = parseCommitment({ ...input, kind: "transfer" });
    expect(parsed.ok && [parsed.row.to_account_id, parsed.row.subcategory_id]).toEqual([CARD, null]);
    expect(parseCommitment({ ...input, kind: "transfer", to_account_id: BANK })).toEqual({
      ok: false,
      error: "Choose two different accounts.",
    });
  });

  test("rejects what the database would", () => {
    const error = (fields: Partial<CommitmentInput>) => {
      const parsed = parseCommitment({ ...input, ...fields });
      return parsed.ok ? null : parsed.error;
    };
    expect(error({ name: " " })).toBe("Give the commitment a name.");
    expect(error({ amount: "0" })).toBe("Enter the amount you expect to pay.");
    expect(error({ subcategory_id: null })).toBe("Choose a category.");
    expect(error({ every: 0 })).toBe("Repeat every 1 to 52 weeks, months or years.");
    expect(error({ every: 1.5 })).toBe("Repeat every 1 to 52 weeks, months or years.");
    expect(error({ first_due_on: "2026-02-30" })).toBe("Enter the date it's due.");
    expect(error({ ends_on: "2026-10-01" })).toBe("The end date is before the first due date.");
    expect(error({ ends_on: "2027-03-31" })).toBeNull();
  });
});

test("describeSchedule", () => {
  expect(describeSchedule({ unit: "month", every: 1, first_due_on: "2026-10-05" })).toBe("Monthly on the 5th");
  expect(describeSchedule({ unit: "month", every: 3, first_due_on: "2026-10-22" })).toBe("Every 3 months on the 22nd");
  expect(describeSchedule({ unit: "month", every: 1, first_due_on: "2026-10-11" })).toBe("Monthly on the 11th");
  expect(describeSchedule({ unit: "week", every: 1, first_due_on: "2026-09-29" })).toBe("Weekly on Tuesday");
  expect(describeSchedule({ unit: "year", every: 1, first_due_on: "2027-03-12" })).toBe("Yearly on 12 Mar");
});

test("isScheduledOn", () => {
  const rent = { unit: "month" as const, every: 1, first_due_on: "2026-01-31" };
  expect(isScheduledOn(rent, "2026-02-28")).toBe(true);
  expect(isScheduledOn(rent, "2026-03-31")).toBe(true);
  expect(isScheduledOn(rent, "2026-03-30")).toBe(false);
  expect(isScheduledOn(rent, "2025-12-31")).toBe(false);
});

describe("recurringOverview", () => {
  const rent = commitment({ id: "rent", amount: 1500000, first_due_on: "2026-08-05" });
  const gym = commitment({ id: "gym", amount: 250000, first_due_on: "2026-09-12" });
  const now = new Date("2026-09-10T06:30:00Z"); // noon IST, 10 Sep

  test("a due date is due now from its day on (FR-6 AC1), one row per commitment", () => {
    const { dueNow } = recurringOverview([rent, gym], [], now);
    expect(dueNow).toEqual([{ type: "due", commitment: rent, due_on: "2026-08-05", more: ["2026-09-05"] }]);
  });

  test("paying covers the oldest due date; skipped ones aren't due", () => {
    const paid = tx({ kind: "expense", amount: 1500000, recurring_id: "rent", occurred_at: at("2026-08-06") });
    expect(recurringOverview([rent], [paid], now).dueNow).toMatchObject([{ due_on: "2026-09-05", more: [] }]);
    const skipped = { ...rent, skipped_on: ["2026-08-05"] };
    expect(recurringOverview([skipped], [paid], now).dueNow).toEqual([]);
  });

  test("upcoming lists up to 30 days ahead, planned entries included, with a total", () => {
    const planned = tx({ kind: "transfer", amount: 500000, is_planned: true, occurred_at: at("2026-09-20") });
    const later = tx({ kind: "expense", amount: 100, is_planned: true, occurred_at: at("2026-11-20") });
    const income = tx({ kind: "income", amount: 100, is_planned: true, occurred_at: at("2026-09-15") });
    const { upcoming, upcomingTotal } = recurringOverview([rent, gym], [planned, later, income], now);
    expect(upcoming.map((u) => [u.date, u.commitment?.id ?? u.entry?.id])).toEqual([
      ["2026-09-12", "gym"],
      ["2026-09-20", planned.id],
      ["2026-10-05", "rent"],
    ]);
    expect(upcomingTotal).toBe(250000 + 500000 + 1500000);
  });

  test("a planned entry whose time has come is due now, to confirm (BR-7)", () => {
    const soon = tx({ kind: "expense", amount: 9900, is_planned: true, occurred_at: "2026-09-10T06:00:00Z" });
    const tonight = tx({ kind: "expense", amount: 9900, is_planned: true, occurred_at: "2026-09-10T14:00:00Z" });
    const { dueNow, upcoming } = recurringOverview([], [soon, tonight], now);
    expect(dueNow).toEqual([{ type: "planned", entry: soon }]);
    expect(upcoming.map((u) => u.entry?.id)).toEqual([tonight.id]);
  });

  test("a planned entry linked to a commitment covers its due date and shows once", () => {
    const planned = tx({
      kind: "expense",
      amount: 250000,
      is_planned: true,
      recurring_id: "gym",
      occurred_at: at("2026-09-12"),
    });
    const { upcoming } = recurringOverview([gym], [planned], now);
    expect(upcoming.map((u) => [u.date, u.entry?.id ?? null, u.commitment?.id])).toEqual([
      ["2026-09-12", planned.id, "gym"],
    ]);
  });
});

test("confirmedAt: now if due today, noon IST on the due date if overdue", () => {
  const now = new Date("2026-09-10T06:30:00Z");
  expect(confirmedAt("2026-09-10", now)).toBe(now);
  expect(confirmedAt("2026-08-31", now).toISOString()).toBe("2026-08-31T06:30:00.000Z");
});

test("dayInSentence", () => {
  expect(dayInSentence("2026-09-10", "2026-09-10")).toBe("today");
  expect(dayInSentence("2026-09-09", "2026-09-10")).toBe("yesterday");
  expect(dayInSentence("2026-09-11", "2026-09-10")).toBe("tomorrow");
  expect(dayInSentence("2026-08-05", "2026-09-10")).toBe("5 Aug");
  expect(dayInSentence("2025-12-31", "2026-01-02")).toBe("31 Dec 2025");
});
