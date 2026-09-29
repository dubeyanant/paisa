// Calendar logic runs in IST, whatever the server's time zone (TD-9).
// India has no daylight saving, so IST is always UTC+05:30.
//
// A calendar date is a "YYYY-MM-DD" string. Such strings sort and compare
// correctly as plain strings.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// A budget month: from `start` up to but not including `end` (both IST dates).
export type Period = { start: string; end: string };

// The IST calendar date of a moment.
export function istDate(moment: Date | string): string {
  const ms = new Date(moment).getTime();
  if (Number.isNaN(ms)) throw new Error(`Invalid moment: ${String(moment)}`);
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The moment an IST calendar date begins.
export function istStartOf(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// Whole days from `from` to `to`.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function ymd(year: number, month: number, day: number): string {
  // Date.UTC rolls months over, so month 13 or 0 lands in the right year.
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

// The budget month containing `date`. Budget months start on `startDay`
// (1-28, FR-12), so with startDay 3 they run from the 3rd to the 2nd.
export function budgetMonthOf(date: string, startDay = 1): Period {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new Error(`Budget month start day must be 1-28, got ${startDay}`);
  }
  const [year, month, day] = date.split("-").map(Number);
  const startMonth = day >= startDay ? month : month - 1;
  return { start: ymd(year, startMonth, startDay), end: ymd(year, startMonth + 1, startDay) };
}

// The budget month `offset` months before (negative) or after (positive) `period`.
export function shiftBudgetMonth(period: Period, offset: number): Period {
  const [year, month, day] = period.start.split("-").map(Number);
  return { start: ymd(year, month + offset, day), end: ymd(year, month + offset + 1, day) };
}

export function periodContains(period: Period, moment: Date | string): boolean {
  const date = istDate(moment);
  return date >= period.start && date < period.end;
}

export function periodLength(period: Period): number {
  return daysBetween(period.start, period.end);
}

// The months "typical month" is averaged over (BR-10): the previous 3 complete
// budget months, or fewer if the history starts later. `firstDate` is the IST
// date of the earliest transaction.
export function typicalMonthPeriods(current: Period, firstDate: string | null): Period[] {
  if (!firstDate) return [];
  const periods: Period[] = [];
  for (let offset = -1; offset >= -3; offset--) {
    const period = shiftBudgetMonth(current, offset);
    if (period.end <= firstDate) break;
    periods.push(period);
  }
  return periods;
}

// The last moment of an IST calendar date.
export function istEndOf(date: string): Date {
  return new Date(istStartOf(addDays(date, 1)).getTime() - 1);
}

// The last `count` budget months, oldest first, ending with `current`.
export function recentPeriods(current: Period, count: number): Period[] {
  return Array.from({ length: count }, (_, i) => shiftBudgetMonth(current, i - count + 1));
}

// The part of the period up to and including `today`.
export function periodSoFar(period: Period, today: string): Period {
  const end = addDays(today, 1);
  return { start: period.start, end: end < period.end ? end : period.end };
}

// Days of the period gone by as of `today`, today included.
export function daysElapsed(period: Period, today: string): number {
  return Math.min(Math.max(daysBetween(period.start, today) + 1, 0), periodLength(period));
}
