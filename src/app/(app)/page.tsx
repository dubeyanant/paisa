import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Amount, Card, PageHeader, buttonClass } from "@/components/ui";
import { listAccounts } from "@/lib/data/accounts";
import { getLabels, getLatestEntries } from "@/lib/data/entries";
import { balanceSummary } from "@/lib/finance/balances";
import { EntryList } from "./entry-list";

// A first Home: where the money is and the latest entries. Insights arrive in
// roadmap step 9.
export default async function Home() {
  const [accounts, labels, { latest, planned }] = await Promise.all([
    listAccounts(),
    getLabels(),
    getLatestEntries(),
  ]);
  const summary = balanceSummary(accounts, new Map(accounts.map((a) => [a.id, a.balance])));

  return (
    <>
      <PageHeader title="Paisa" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <Link href="/accounts" className="block rounded-2xl lg:sticky lg:top-8">
          <Card className="p-4 transition-colors hover:bg-foreground/[0.03] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Available in bank and cash</p>
              <ChevronRightIcon className="-mr-1 size-5 text-muted" />
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              <Amount value={summary.available} />
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
              <div className="min-w-0">
                <dt className="text-sm text-muted">Card dues</dt>
                <dd className="truncate font-medium tabular-nums">
                  <Amount value={summary.cardDues} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted">Net position</dt>
                <dd className="truncate font-medium tabular-nums">
                  <Amount value={summary.netPosition} />
                </dd>
              </div>
            </dl>
          </Card>
        </Link>

        <div className="flex min-w-0 flex-col gap-6">
          {planned.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Planned</h2>
              <EntryList entries={planned} {...labels} />
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
