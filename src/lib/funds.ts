// Logic behind the fund screens (TD-21): checking a fund before it's saved,
// the months a goal can run over, and describing where a fund stands. The
// balances themselves come from src/lib/finance/funds.ts.

import { periodLabel } from "@/lib/budget";
import { isDate, parseName } from "@/lib/categories";
import { budgetMonthOf, shiftBudgetMonth, type Period } from "@/lib/finance/dates";
import { finishedMonths, type Fund, type FundState } from "@/lib/finance/funds";
import { formatINR, parseRupees } from "@/lib/finance/money";

export type FundInput = {
  name: string;
  kind: "goal" | "ongoing";
  bucket_id: string | null;
  // Rupees, as typed. "" when not set.
  target: string;
  monthly_amount: string;
  cap: string;
  // A goal's first and last budget months, as each month's first day.
  from_month: string;
  to_month: string;
  // Rupees to put in straight away. Only when the fund is new.
  put_in: string;
};

export type FundFields = Pick<Fund, "kind" | "bucket_id" | "target" | "monthly_amount" | "cap" | "schedule_from" | "ends_on"> & {
  name: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How far ahead a goal's last month can be.
export const MAX_GOAL_MONTHS = 60;

function optionalRupees(value: string): number | null | undefined {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const paise = parseRupees(text);
  return paise ? paise : undefined;
}

// Turns what was entered for a new fund into a row to save, as the database
// requires. An ongoing fund starts this budget month.
export function parseNewFund(
  input: FundInput,
  current: Period,
): { ok: true; row: FundFields; putIn: number } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (input.kind !== "goal" && input.kind !== "ongoing") return fail("Choose what kind of fund this is.");
  const putIn = optionalRupees(input.put_in);
  if (putIn === undefined) return fail("Enter the amount to put in now, or leave it empty.");

  if (input.kind === "goal") {
    if (!isDate(String(input.from_month ?? ""))) return fail("Choose the month to start saving.");
    if (input.from_month < current.start) return fail("Start saving this month or later.");
  }
  const fields = parseFields(input, input.kind, input.kind === "goal" ? input.from_month : current.start);
  if (!fields.ok) return fields;
  return { ok: true, row: fields.row, putIn: putIn ?? 0 };
}

// The same for a change to an existing fund. A goal that has started keeps its
// start; its last month can't be in the past.
export function parseFundChange(
  fund: Fund,
  input: FundInput,
  current: Period,
  startDay: number,
): { ok: true; row: FundFields } | { ok: false; error: string } {
  const started = budgetMonthOf(fund.schedule_from, startDay).start <= current.start;
  let from = fund.schedule_from;
  if (fund.kind === "goal" && !started) {
    if (!isDate(String(input.from_month ?? ""))) return { ok: false, error: "Choose the month to start saving." };
    if (input.from_month < current.start) return { ok: false, error: "Start saving this month or later." };
    from = input.from_month;
  }
  const parsed = parseFields(input, fund.kind, from);
  // A goal whose months are over can still be renamed, but saving more needs
  // a last month from this one on.
  if (parsed.ok && fund.kind === "goal" && started && parsed.row.ends_on! < current.start) {
    if (parsed.row.ends_on !== fund.ends_on || parsed.row.target !== fund.target) {
      return { ok: false, error: "The last month can't be in the past." };
    }
  }
  return parsed;
}

function parseFields(
  input: FundInput,
  kind: Fund["kind"],
  scheduleFrom: string,
): { ok: true; row: FundFields } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const name = parseName(input.name, "fund");
  if (!name.ok) return name;
  const bucket_id = input.bucket_id || null;
  if (bucket_id && !UUID.test(bucket_id)) return fail("Something went wrong. Reload and try again.");

  if (kind === "goal") {
    const target = optionalRupees(input.target);
    if (!target) return fail("Enter how much you're saving up.");
    if (!isDate(String(input.to_month ?? ""))) return fail("Choose the last month to save in.");
    if (input.to_month < scheduleFrom) return fail("The last month is before the first.");
    return {
      ok: true,
      row: { name: name.name, kind, bucket_id, target, monthly_amount: null, cap: null, schedule_from: scheduleFrom, ends_on: input.to_month },
    };
  }

  const monthly = optionalRupees(input.monthly_amount);
  if (monthly === undefined) return fail("Enter the amount to put in each month, or leave it empty.");
  const cap = optionalRupees(input.cap);
  if (cap === undefined) return fail("Enter the most the fund should hold, or leave it empty.");
  return {
    ok: true,
    row: { name: name.name, kind, bucket_id, target: null, monthly_amount: monthly, cap, schedule_from: scheduleFrom, ends_on: null },
  };
}

// Whether a change touches the schedule, so the finished months need keeping.
export function scheduleChanged(fund: Fund, row: FundFields): boolean {
  return (
    fund.target !== row.target ||
    fund.monthly_amount !== row.monthly_amount ||
    fund.cap !== row.cap ||
    fund.ends_on !== row.ends_on ||
    fund.schedule_from !== row.schedule_from
  );
}

// What a change saves: the fields, and when the schedule changes on a fund
// that has started, the finished months kept and the schedule moved on to
// this month.
export function fundChange(
  state: FundState,
  row: FundFields,
  current: Period,
  startDay: number,
): { row: FundFields; kept: { amount: number; occurred_at: string }[] } {
  const started = budgetMonthOf(state.fund.schedule_from, startDay).start <= current.start;
  if (!started || !scheduleChanged(state.fund, row)) return { row, kept: [] };
  return { row: { ...row, schedule_from: current.start }, kept: finishedMonths(state, current) };
}

// What a goal puts in per month, for the form: the first month's share from
// what's held before it, then the share of each month after, once `extra`
// (money added later that month) is in. Worked out as the schedule does
// (src/lib/finance/funds.ts). `then` is null with one month left.
export function goalPreview(
  target: number,
  before: number,
  extra: number,
  months: number,
): { first: number; then: number | null } {
  const share = (left: number, n: number) => (left <= 0 ? 0 : Math.min(left, Math.ceil(left / (n * 100)) * 100));
  if (months <= 0) return { first: 0, then: null };
  const first = share(target - before, months);
  return { first, then: months > 1 ? share(target - before - first - extra, months - 1) : null };
}

// A budget month's name with its year: "October 2026", or "21 Sep – 20 Oct 2026".
export function monthName(period: Period): string {
  const label = periodLabel(period);
  return period.start.endsWith("-01") ? label : `${label} ${period.end.slice(0, 4)}`;
}

// The budget months a goal can start or end in, from `from` on.
export function monthChoices(from: Period, count = MAX_GOAL_MONTHS): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const period = shiftBudgetMonth(from, i);
    return { value: period.start, label: monthName(period) };
  });
}

// A fund's standing in a few words, for lists: "₹15,000 this month · 3 months
// left", "Saved up · ₹18,000 spent", "₹2,000 a month, up to ₹5,000".
export function fundDetail(state: FundState, startDay: number): string {
  const { fund } = state;
  if (state.closedAt) return "Closed";
  if (fund.kind === "goal") {
    const spent = state.spent > 0 ? ` · ${formatINR(state.spent)} spent` : "";
    if (state.monthsLeft === 0) {
      const end = state.saved >= (fund.target ?? 0) ? "Saved up" : `Saving ended ${monthName(budgetMonthOf(fund.ends_on!, startDay))}`;
      return end + spent;
    }
    const left = `${state.monthsLeft} ${state.monthsLeft === 1 ? "month" : "months"} left`;
    return (state.thisMonth > 0 ? `${formatINR(state.thisMonth)} this month · ${left}` : left) + spent;
  }
  if (!fund.monthly_amount) return fund.cap ? `Up to ${formatINR(fund.cap)}` : "Added by hand";
  const monthly = `${formatINR(fund.monthly_amount)} a month`;
  return fund.cap ? `${monthly}, up to ${formatINR(fund.cap)}` : monthly;
}

// For a target fund nothing has been spent from, "₹30,000 of ₹60,000";
// otherwise just what it holds.
export function fundHeld(state: FundState): string {
  const held = formatINR(state.balance);
  const saving = state.fund.kind === "goal" && !state.closedAt && state.spent === 0;
  return saving ? `${held} of ${formatINR(state.fund.target ?? 0)}` : held;
}
