// The Entries screen's filters (FR-8.3): read from the URL, written back to it,
// and turned into arguments for search_transactions() and transaction_totals()
// (supabase/migrations/*_entry_search_and_merge.sql).

import { addDays, budgetMonthOf, istStartOf, shiftBudgetMonth } from "@/lib/finance/dates";
import { parseRupees, toRupeesInput } from "@/lib/finance/money";
import type { TransactionKind } from "@/lib/finance/types";

export type EntryFilters = {
  // Text in the note, the description or the subcategory's name.
  q?: string;
  // IST dates, both included.
  from?: string;
  to?: string;
  account?: string;
  category?: string;
  subcategory?: string;
  bucket?: string;
  tag?: string;
  kind?: TransactionKind;
  // Paise, compared with the size of the amount.
  min?: number;
  max?: number;
};

export const KIND_FILTERS: { kind: TransactionKind; label: string }[] = [
  { kind: "expense", label: "Expenses" },
  { kind: "income", label: "Income" },
  { kind: "refund", label: "Refunds" },
  { kind: "transfer", label: "Transfers" },
  { kind: "adjustment", label: "Balance corrections" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_KEYS = ["account", "category", "subcategory", "bucket", "tag"] as const;

type Params = Record<string, string | string[] | undefined>;

// A real "YYYY-MM-DD" date, not 2026-02-30.
function isDate(value: string) {
  if (!DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// Reads filters from the page's search params. Anything malformed is dropped,
// so a hand-edited URL can't reach the database.
export function parseFilters(params: Params): EntryFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const filters: EntryFilters = {};

  const q = one("q");
  if (q) filters.q = q.slice(0, 100);
  for (const key of ["from", "to"] as const) {
    const date = one(key);
    if (date && isDate(date)) filters[key] = date;
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    [filters.from, filters.to] = [filters.to, filters.from];
  }
  for (const key of ID_KEYS) {
    const id = one(key);
    if (id && UUID.test(id)) filters[key] = id;
  }
  // A subcategory already says which category.
  if (filters.subcategory) delete filters.category;
  const kind = one("kind");
  if (KIND_FILTERS.some((k) => k.kind === kind)) filters.kind = kind as TransactionKind;
  for (const key of ["min", "max"] as const) {
    const value = one(key);
    const paise = value ? parseRupees(value) : null;
    if (paise !== null) filters[key] = paise;
  }
  if (filters.min !== undefined && filters.max !== undefined && filters.min > filters.max) {
    [filters.min, filters.max] = [filters.max, filters.min];
  }
  return filters;
}

// The query string for these filters, in a fixed order. Amounts are in rupees.
export function filtersQuery(filters: EntryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  for (const key of ID_KEYS) if (filters[key]) params.set(key, filters[key]);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.min !== undefined) params.set("min", toRupeesInput(filters.min));
  if (filters.max !== undefined) params.set("max", toRupeesInput(filters.max));
  return params.toString();
}

// How many filters are set, besides the search text.
export function activeFilterCount(f: EntryFilters): number {
  return [
    f.from || f.to,
    f.account,
    f.category || f.subcategory,
    f.bucket,
    f.tag,
    f.kind,
    f.min !== undefined || f.max !== undefined,
  ].filter(Boolean).length;
}

// Named arguments for search_transactions() and transaction_totals(). Filters
// not set are left out, and the function treats them as "any".
export function searchArgs(filters: EntryFilters): Record<string, string | number | string[]> {
  const args: Record<string, string | number | string[]> = {};
  if (filters.q) args.search = filters.q;
  if (filters.from) args.since = istStartOf(filters.from).toISOString();
  if (filters.to) args.until = istStartOf(addDays(filters.to, 1)).toISOString();
  for (const key of ID_KEYS) if (filters[key]) args[key] = filters[key];
  if (filters.kind) args.kinds = [filters.kind];
  if (filters.min !== undefined) args.min_amount = filters.min;
  if (filters.max !== undefined) args.max_amount = filters.max;
  return args;
}

// Date ranges one tap away. Months are calendar months until the budget month
// start day becomes a setting (FR-12, Phase 2).
export type DatePreset = { id: string; label: string; from: string; to: string };

export function datePresets(today: string): DatePreset[] {
  const month = budgetMonthOf(today);
  const last = shiftBudgetMonth(month, -1);
  const year = today.slice(0, 4);
  return [
    { id: "this-month", label: "This month", from: month.start, to: addDays(month.end, -1) },
    { id: "last-month", label: "Last month", from: last.start, to: addDays(last.end, -1) },
    { id: "3-months", label: "Last 3 months", from: shiftBudgetMonth(month, -2).start, to: addDays(month.end, -1) },
    { id: "this-year", label: "This year", from: `${year}-01-01`, to: `${year}-12-31` },
  ];
}

// "This month", "1 Mar – 15 Mar 2026", "From 1 Mar 2026"…
export function describeRange(from: string | undefined, to: string | undefined, today: string): string {
  const preset = datePresets(today).find((p) => p.from === from && p.to === to);
  if (preset) return preset.label;
  const format = (date: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  if (from && to) {
    if (from === to) return format(from, true);
    return `${format(from, from.slice(0, 4) !== to.slice(0, 4))} – ${format(to, true)}`;
  }
  if (from) return `From ${format(from, true)}`;
  if (to) return `Up to ${format(to, true)}`;
  return "Any time";
}
