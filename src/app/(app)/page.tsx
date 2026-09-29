import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Amount, Card, PageHeader, buttonClass } from "@/components/ui";
import { statusLabel } from "@/lib/budget";
import { getLabels, getLatestEntries } from "@/lib/data/entries";
import { getHomeInsights } from "@/lib/data/home";
import { getMoneySummary } from "@/lib/data/summary";
import { describeEntry } from "@/lib/describe-entry";
import type { BucketAdherence } from "@/lib/finance/budget";
import { daysElapsed } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import { alertText, freeMoneyText, paceText, savingsText, type AlertNames, type AlertText } from "@/lib/home";
import { recurringOverview } from "@/lib/recurring";
import { EntryList } from "./entry-list";
import { ComingUp } from "./more/planned/coming-up";
import { DueNow } from "./more/planned/due-now";
import { dueRows, fallbackName, lookups } from "./more/planned/rows";

// Home (FR-8): what's free to spend, this month at a glance (free money,
// pace, savings rate, budget buckets), the top alerts (INS-19), planned
// payments due now and coming up, and the latest entries.
export default async function Home() {
  const now = new Date();
  const [{ summary, accounts, commitments, scheduled, month, today }, labels, { latest }] = await Promise.all([
    getMoneySummary(now),
    getLabels(),
    getLatestEntries(),
  ]);
  const insights = await getHomeInsights({ accounts, commitments, scheduled, month, today, labels });
  const l = lookups(labels);
  const { dueNow, upcoming, upcomingTotal } = recurringOverview(commitments, scheduled, now);
  const due = dueRows(dueNow, commitments, l, today);

  const categoryName = new Map(labels.subcategories.map((s) => [s.category_id, s.category]));
  const commitmentName = new Map(commitments.map((c) => [c.id, c.name]));
  const names: AlertNames = {
    category: (id) => categoryName.get(id) ?? "A category",
    payment: (p) =>
      p.commitment
        ? (commitmentName.get(p.commitment.id) ?? "A payment")
        : p.series!.note || fallbackName(p.series!, l),
    upcoming: (item) => {
      if (item.commitment_id && !item.transaction_id) return commitmentName.get(item.commitment_id) ?? "A payment";
      const entry = scheduled.find((t) => t.id === item.transaction_id);
      return entry ? describeEntry({ ...entry, note: entry.note ?? null }, l.accountById, l.subById).title : "A payment";
    },
  };
  const day = daysElapsed(month, today);
  const alerts = insights.alerts.map((a) => alertText(a, names, { day, month, today }));
  const pace = paceText(insights.pace);
  const savings = savingsText(insights.savings, insights.firstDate);

  return (
    <>
      <PageHeader title="Paisa" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Link href="/accounts" className="block rounded-2xl">
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

          <Alerts alerts={alerts} className="lg:hidden" />

          <Card className="divide-y divide-line">
            <div className="p-4 md:p-6">
              <p className="text-sm text-muted">Free money left this month</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                <Amount value={insights.free.freeLeft} />
              </p>
              <p className="mt-1 text-sm text-muted">{freeMoneyText(insights.free)}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 p-4 md:px-6">
              <div className="min-w-0">
                <dt className="text-sm text-muted">Spent vs a usual month</dt>
                <dd className={`text-xl font-semibold tabular-nums ${pace.hot ? "text-negative" : ""}`}>
                  {pace.figure}
                </dd>
                <dd className="mt-1 text-sm text-muted">{pace.text}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-sm text-muted">Savings rate</dt>
                <dd className="text-xl font-semibold tabular-nums">{savings.figure}</dd>
                <dd className="mt-1 text-sm text-muted">{savings.text}</dd>
              </div>
            </dl>
            {insights.budget && insights.budget.buckets.length > 0 && (
              <Link
                href="/budget"
                className="block p-4 transition-colors last:rounded-b-2xl hover:bg-foreground/[0.03] md:px-6"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">Budget</p>
                  <ChevronRightIcon className="-mr-1 size-5 text-muted" />
                </div>
                <ul className="flex flex-col gap-3">
                  {insights.budget.buckets.map((b) => (
                    <BucketRow key={b.bucket.id} b={b} />
                  ))}
                </ul>
              </Link>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Alerts alerts={alerts} className="hidden lg:block" />
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
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">Planned</h2>
                  <p className="text-sm text-muted tabular-nums">{formatINR(upcomingTotal)} in the next 30 days</p>
                </div>
                <Link href="/more/planned" className="flex h-11 items-center text-sm font-medium text-accent">
                  See all
                </Link>
              </div>
              <ComingUp items={upcoming.slice(0, 3)} commitments={commitments} l={l} today={today} />
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

// The top alerts (INS-19). On a phone they come right after available to
// spend; on a laptop they head the right-hand column.
function Alerts({ alerts, className }: { alerts: AlertText[]; className: string }) {
  return (
    <section className={className}>
      <div className="mb-1 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Alerts</h2>
        <Link href="/insights" className="flex h-11 items-center text-sm font-medium text-accent">
          All insights
        </Link>
      </div>
      {alerts.length === 0 ? (
        <Card className="px-4 py-3.5 text-sm text-muted">Nothing to flag right now.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li key={a.title}>
                <Link
                  href={a.href}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-sm text-muted">{a.detail}</p>
                  </div>
                  <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

const BAR = { on_track: "bg-accent", at_risk: "bg-warning", over: "bg-negative" };
const LABEL = { on_track: "text-muted", at_risk: "text-warning", over: "text-negative" };

// A bucket at a glance: how much of its target is used.
function BucketRow({ b }: { b: BucketAdherence }) {
  const filled = b.target > 0 ? Math.min(b.actual / b.target, 1) : b.actual > 0 ? 1 : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="min-w-0 truncate font-medium">{b.bucket.name}</p>
        <p className={`shrink-0 font-medium ${LABEL[b.status]}`}>{statusLabel(b)}</p>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden>
        <div className={`h-1.5 rounded-full ${BAR[b.status]}`} style={{ width: `${filled * 100}%` }} />
      </div>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {formatINR(b.actual)} of {formatINR(b.target)}
      </p>
    </li>
  );
}
