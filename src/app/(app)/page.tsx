import Link from "next/link";
import { Suspense } from "react";
import { BudgetBar } from "@/components/budget-bar";
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
import { alertText, paceText, savingsText, type AlertNames, type AlertText } from "@/lib/home";
import { recurringOverview } from "@/lib/recurring";
import { EntryList } from "./entry-list";
import { ComingUp } from "./more/planned/coming-up";
import { DueNow } from "./more/planned/due-now";
import { dueRows, fallbackName, lookups } from "./more/planned/rows";

type Summary = Awaited<ReturnType<typeof getMoneySummary>>;
type Labels = Awaited<ReturnType<typeof getLabels>>;
type Insights = Awaited<ReturnType<typeof getHomeInsights>>;
type Latest = Awaited<ReturnType<typeof getLatestEntries>>;

// Home (FR-8): what's free to spend, this month at a glance (everyday
// spending pace, last month's savings rate, budget buckets), the top alerts
// (INS-19), planned payments due now and coming up, and the latest entries.
//
// Every load starts here at once, and each part shows as soon as its own
// data is ready: available to spend, Due now and the latest entries first,
// then the insights and alerts, which also need 7 months of entries.
export default function Home() {
  const now = new Date();
  const summary = getMoneySummary(now);
  const labels = getLabels();
  const latest = getLatestEntries();
  const insights = getHomeInsights(summary, labels);
  const alerts = Promise.all([summary, labels, insights]).then(([s, l, i]) => alertTexts(s, l, i));

  return (
    <>
      <PageHeader title="Paisa" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Suspense fallback={<Placeholder className="h-52 md:h-60" />}>
            <Spendable summary={summary} />
          </Suspense>
          <Suspense fallback={<Placeholder className="h-40 lg:hidden" />}>
            <Alerts alerts={alerts} className="lg:hidden" />
          </Suspense>
          <Suspense fallback={<Placeholder className="h-72" />}>
            <Glance insights={insights} />
          </Suspense>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Suspense fallback={<Placeholder className="hidden h-40 lg:block" />}>
            <Alerts alerts={alerts} className="hidden lg:block" />
          </Suspense>
          <Suspense fallback={null}>
            <Planned summary={summary} labels={labels} now={now} />
          </Suspense>
          <Suspense fallback={<Placeholder className="h-96" />}>
            <LatestEntries latest={latest} labels={labels} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

// A grey block the size of the part it stands in for, while that part loads.
function Placeholder({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-foreground/[0.06] ${className}`} />;
}

// Each alert as a sentence, with the names of what it's about.
function alertTexts({ commitments, scheduled, month, today }: Summary, labels: Labels, insights: Insights) {
  const l = lookups(labels);
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
  return insights.alerts.map((a) => alertText(a, names, { day, month, today }));
}

async function Spendable({ summary: loading }: { summary: Promise<Summary> }) {
  const { summary } = await loading;
  return (
    <Link href="/accounts" className="block rounded-2xl">
      <Card className="p-4 transition-colors hover:bg-foreground/[0.03] md:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Available to spend</p>
          <ChevronRightIcon className="-mr-1 size-5 text-muted" />
        </div>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          <Amount value={summary.spendable} className="text-spendable" />
        </p>
        <p className="mt-1 text-sm text-muted">Bank and cash, minus what&rsquo;s planned this month and card dues.</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <dt className="text-sm text-muted">Planned this month</dt>
            <dd className="truncate font-medium tabular-nums">
              <Amount value={summary.planned} className="text-planned" />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-muted">Card dues</dt>
            <dd className={`truncate font-medium tabular-nums ${summary.cardDues > 0 ? "text-negative" : ""}`}>
              {formatINR(summary.cardDues)}
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
  );
}

// Everyday spending against usual, last month's savings and each budget bucket.
async function Glance({ insights: loading }: { insights: Promise<Insights> }) {
  const insights = await loading;
  const pace = paceText(insights.pace);
  const savings = savingsText(insights.savings, insights.firstDate);
  return (
    <Card className="divide-y divide-line">
      <dl className="grid grid-cols-2 gap-4 p-4 md:p-6">
        <div className="min-w-0">
          <dt className="text-sm text-muted">Everyday spending vs usual</dt>
          <dd className={`text-xl font-semibold tabular-nums ${pace.hot ? "text-negative" : ""}`}>
            {pace.figure}
          </dd>
          <dd className="mt-1 text-sm text-muted">{pace.text}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-muted">Saved last month</dt>
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
  );
}

// Planned payments due now, and the next few coming up with the 30-day total.
async function Planned({ summary, labels, now }: { summary: Promise<Summary>; labels: Promise<Labels>; now: Date }) {
  const [{ commitments, scheduled, today }, l] = await Promise.all([summary, labels.then(lookups)]);
  const { dueNow, upcoming, upcomingTotal } = recurringOverview(commitments, scheduled, now);
  const due = dueRows(dueNow, commitments, l, today);
  return (
    <>
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
              <p className="text-sm text-muted tabular-nums"><span className="text-planned">{formatINR(upcomingTotal)}</span> in the next 30 days</p>
            </div>
            <Link href="/more/planned" className="flex h-11 items-center text-sm font-medium text-accent">
              See all
            </Link>
          </div>
          <ComingUp items={upcoming.slice(0, 3)} commitments={commitments} l={l} today={today} />
        </section>
      )}
    </>
  );
}

async function LatestEntries({ latest: loading, labels }: { latest: Promise<Latest>; labels: Promise<Labels> }) {
  const [{ latest }, l] = await Promise.all([loading, labels]);
  return (
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
        <EntryList entries={latest} {...l} />
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
  );
}

// The top alerts (INS-19). On a phone they come right after available to
// spend; on a laptop they head the right-hand column.
async function Alerts({ alerts: loading, className }: { alerts: Promise<AlertText[]>; className: string }) {
  const alerts = await loading;
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

const LABEL = { on_track: "text-muted", at_risk: "text-warning", over: "text-negative" };

// A bucket at a glance: how much of its target is used, and planned payments
// still to come in a lighter shade.
function BucketRow({ b }: { b: BucketAdherence }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="min-w-0 truncate font-medium">{b.bucket.name}</p>
        <p className={`shrink-0 font-medium ${LABEL[b.status]}`}>{statusLabel(b)}</p>
      </div>
      <div className="mt-1.5">
        <BudgetBar b={b} size="sm" />
      </div>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {formatINR(b.actual)} of {formatINR(b.target)}
        {b.plannedLeft > 0 && ` · ${formatINR(b.plannedLeft)} still planned`}
      </p>
    </li>
  );
}
