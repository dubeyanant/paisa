import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import {
  getEntryTotals,
  getFilterOptions,
  getLabels,
  searchEntries,
  type EntryTotals,
} from "@/lib/data/entries";
import { activeFilterCount, filtersQuery, parseFilters, type EntryFilters } from "@/lib/entry-filters";
import { istDate } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import { EntryList } from "../entry-list";
import { EntriesView } from "./entries-view";

export const metadata: Metadata = { title: "Entries · Paisa" };

const PAGE = 50;
// The API returns at most 1,000 rows per request.
const MOST = 1000;

// Every entry, with search, filters and totals for what matches (FR-8.3).
// The header shows at once, then the filters, then what matches. When the
// filters change, the old results stay until the new ones are in.
export default function EntriesPage({ searchParams }: PageProps<"/entries">) {
  return (
    <>
      <PageHeader title="Entries" />
      <Suspense fallback={<Placeholder className="h-24" />}>
        <Entries searchParams={searchParams} />
      </Suspense>
    </>
  );
}

// A grey block the size of what it stands in for, while that loads.
function Placeholder({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-foreground/[0.06] ${className}`} />;
}

async function Entries({ searchParams }: Pick<PageProps<"/entries">, "searchParams">) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const shown = Math.min(Math.max(Math.floor(Number(params.n) / PAGE) || 1, 1) * PAGE, MOST);
  const labels = getLabels();
  const results = Promise.all([searchEntries(filters, shown), getEntryTotals(filters)]);
  const [l, options] = await Promise.all([labels, getFilterOptions()]);
  return (
    <EntriesView filters={filters} today={istDate(new Date())} {...l} {...options}>
      <Suspense
        fallback={
          <div className="flex flex-col gap-5">
            <Placeholder className="h-28" />
            <Placeholder className="h-96" />
          </div>
        }
      >
        <Results filters={filters} shown={shown} labels={labels} results={results} />
      </Suspense>
    </EntriesView>
  );
}

async function Results({
  filters,
  shown,
  labels: loadingLabels,
  results,
}: {
  filters: EntryFilters;
  shown: number;
  labels: ReturnType<typeof getLabels>;
  results: Promise<[Awaited<ReturnType<typeof searchEntries>>, EntryTotals]>;
}) {
  const [labels, [entries, totals]] = await Promise.all([loadingLabels, results]);
  const query = filtersQuery(filters);
  const filtered = Boolean(filters.q) || activeFilterCount(filters) > 0;

  return (
    <>
      {totals.entries === 0 ? (
        <Card className="p-6 text-center">
          <p className="font-medium">{filtered ? "No entries match" : "Nothing logged yet"}</p>
          <p className="mt-1 text-sm text-muted">
            {filtered ? "Try other words, or fewer filters." : "Your entries will show up here."}
          </p>
          {filtered ? (
            <Link href="/entries" className={`${buttonClass.secondary} mt-4`}>
              Show every entry
            </Link>
          ) : (
            <Link href="/add" className={`${buttonClass.primary} mt-4`}>
              Add an entry
            </Link>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <Totals totals={totals} />
          <EntryList entries={entries} {...labels} showPlanned />
          {entries.length < totals.entries && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted">
                Showing {entries.length.toLocaleString("en-IN")} of {totals.entries.toLocaleString("en-IN")}
              </p>
              {shown < MOST ? (
                <Link
                  href={`/entries?${query ? `${query}&` : ""}n=${shown + PAGE}`}
                  scroll={false}
                  replace
                  className={buttonClass.secondary}
                >
                  Show more
                </Link>
              ) : (
                <p className="text-sm text-muted">Narrow the dates or filters to see the rest.</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// What the matching entries add up to. Only the figures that apply show, and
// planned entries don't count until their date (BR-7).
function Totals({ totals }: { totals: EntryTotals }) {
  const figures = [
    totals.spending >= 0
      ? { label: "Spent", value: totals.spending, hint: "Expenses minus refunds" }
      : { label: "Refunded", value: -totals.spending, hint: "More came back than went out" },
    { label: "Income", value: totals.income },
    { label: "Invested", value: totals.invested, hint: "Moved into savings" },
    { label: "Withdrawn", value: totals.withdrawn, hint: "Taken out of savings" },
  ].filter((f) => f.value !== 0);
  const confirmed = totals.entries - totals.planned;

  return (
    <Card className="p-4">
      <p className="text-sm text-muted">
        {totals.entries.toLocaleString("en-IN")} {totals.entries === 1 ? "entry" : "entries"}
        {totals.planned > 0 && confirmed > 0 && (
          <> · {totals.planned.toLocaleString("en-IN")} planned, not counted yet</>
        )}
        {totals.planned > 0 && confirmed === 0 && <> · planned, not counted yet</>}
      </p>
      {figures.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-sm text-muted">{f.label}</dt>
              <dd className="truncate text-lg font-semibold tabular-nums">{formatINR(f.value)}</dd>
              {f.hint && <dd className="text-xs text-muted">{f.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
