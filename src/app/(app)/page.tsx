import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Amount, Card, PageHeader, buttonClass } from "@/components/ui";
import { getLabels, getLatestEntries } from "@/lib/data/entries";
import { getMoneySummary } from "@/lib/data/summary";
import { recurringOverview } from "@/lib/recurring";
import { EntryList } from "./entry-list";
import { ComingUp } from "./more/planned/coming-up";
import { DueNow } from "./more/planned/due-now";
import { dueRows, lookups } from "./more/planned/rows";

// A first Home: what's free to spend, planned payments due now and coming up,
// and the latest entries. Insights arrive in roadmap step 9.
export default async function Home() {
  const now = new Date();
  const [{ summary, commitments, scheduled, today }, labels, { latest }] = await Promise.all([
    getMoneySummary(now),
    getLabels(),
    getLatestEntries(),
  ]);
  const l = lookups(labels);
  const { dueNow, upcoming } = recurringOverview(commitments, scheduled, now);
  const due = dueRows(dueNow, commitments, l, today);

  return (
    <>
      <PageHeader title="Paisa" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <Link href="/accounts" className="block rounded-2xl lg:sticky lg:top-8">
          <Card className="p-4 transition-colors hover:bg-foreground/[0.03] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Available to spend</p>
              <ChevronRightIcon className="-mr-1 size-5 text-muted" />
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              <Amount value={summary.spendable} />
            </p>
            <p className="mt-1 text-sm text-muted">Bank and cash, minus what&rsquo;s planned this month and card dues.</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
              <div className="min-w-0">
                <dt className="text-sm text-muted">Planned this month</dt>
                <dd className="truncate font-medium tabular-nums">
                  <Amount value={summary.planned} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted">Card dues</dt>
                <dd className="truncate font-medium tabular-nums">
                  <Amount value={summary.cardDues} />
                </dd>
              </div>
              {summary.setAside !== 0 && (
                <div className="min-w-0">
                  <dt className="text-sm text-muted">Set aside</dt>
                  <dd className="truncate font-medium tabular-nums">
                    <Amount value={summary.setAside} />
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </Link>

        <div className="flex min-w-0 flex-col gap-6">
          {due.length > 0 && (
            <section>
              <div className="mb-1 flex min-h-11 items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Due now</h2>
                <Link href="/more/planned" className="flex h-11 items-center text-sm font-medium text-accent">
                  All planned
                </Link>
              </div>
              <DueNow rows={due} />
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <div className="mb-1 flex min-h-11 items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Planned</h2>
                <Link href="/more/planned" className="flex h-11 items-center text-sm font-medium text-accent">
                  See all
                </Link>
              </div>
              <ComingUp items={upcoming.slice(0, 5)} commitments={commitments} l={l} today={today} />
            </section>
          )}
          <section>
            <div className="mb-1 flex min-h-11 items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Latest</h2>
              {latest.length > 0 && (
                <Link href="/entries" className="flex h-11 items-center text-sm font-medium text-accent">
                  See all
                </Link>
              )}
            </div>
            {latest.length > 0 ? (
              <EntryList entries={latest} {...labels} />
            ) : (
              <Card className="p-6 text-center">
                <p className="font-medium">Nothing logged yet</p>
                <p className="mt-1 text-sm text-muted">Your entries will show up here.</p>
                <Link href="/add" className={`${buttonClass.primary} mt-4`}>
                  Add an entry
                </Link>
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
