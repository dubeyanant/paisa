import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { getLabels } from "@/lib/data/entries";
import { getDetectionHistory, type CommitmentRow } from "@/lib/data/recurring";
import { getMoneySummary } from "@/lib/data/summary";
import { addDays } from "@/lib/finance/dates";
import { detectRecurring } from "@/lib/finance/detection";
import { formatINR } from "@/lib/finance/money";
import { recurringCost } from "@/lib/finance/recurring";
import { dayInSentence, describeSchedule, recurringOverview } from "@/lib/recurring";
import { ComingUp } from "./coming-up";
import { DueNow } from "./due-now";
import { commitmentDetail, dueRows, fallbackName, lookups, paidWith } from "./rows";

export const metadata: Metadata = { title: "Planned · Paisa" };

const listItem =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]";

// Planned payments (FR-6, TD-18): what's due now, what's coming up, and every
// repeating payment, with payments found in the history offered as new ones.
// The header shows at once. Every load starts here; the suggestions, which
// look through 400 days of entries, can arrive a moment after the rest.
export default function PlannedPage() {
  const now = new Date();
  const summary = getMoneySummary(now);
  const labels = getLabels();
  const history = getDetectionHistory();
  return (
    <>
      <PageHeader
        title="Planned"
        back={{ href: "/more", label: "Back to more" }}
        action={
          <Link href="/more/planned/new" className={buttonClass.secondary}>
            <PlusIcon className="size-5" />
            New
          </Link>
        }
      />
      <Suspense
        fallback={
          <div aria-hidden className="grid animate-pulse items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
            <div className="h-80 rounded-2xl bg-foreground/[0.06]" />
            <div className="h-64 rounded-2xl bg-foreground/[0.06]" />
          </div>
        }
      >
        <Planned summary={summary} labels={labels} history={history} now={now} />
      </Suspense>
    </>
  );
}

type Loading = {
  summary: ReturnType<typeof getMoneySummary>;
  labels: ReturnType<typeof getLabels>;
  history: ReturnType<typeof getDetectionHistory>;
};

async function Planned({ summary: loadingSummary, labels: loadingLabels, history, now }: Loading & { now: Date }) {
  const [{ summary, commitments, scheduled: transactions, month, today }, labels] = await Promise.all([
    loadingSummary,
    loadingLabels,
  ]);
  const l = lookups(labels);
  const overview = recurringOverview(commitments, transactions, now);
  const planned = summary.planned;

  const active = commitments.filter((c) => !c.paused_at && (!c.ends_on || c.ends_on >= today));
  const inactive = commitments.filter((c) => !active.includes(c));

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="grid grid-cols-2 gap-4 p-4 md:p-6">
            <div className="min-w-0">
              <p className="text-sm text-muted">Still to pay this month</p>
              <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-planned tabular-nums">{formatINR(planned)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted">Next 30 days</p>
              <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-planned tabular-nums">
                {formatINR(overview.upcomingTotal)}
              </p>
            </div>
            <p className="col-span-2 text-sm text-muted">
              Planned payments until {dayInSentence(addDays(month.end, -1), today)}, overdue ones included. The money
              stays in your accounts until you confirm each one, but it isn&rsquo;t counted as free to spend.
            </p>
          </Card>

          {overview.dueNow.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Due now</h2>
              <DueNow rows={dueRows(overview.dueNow, commitments, l, today)} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold">Coming up</h2>
            {overview.upcoming.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted">Nothing due in the next 30 days.</Card>
            ) : (
              <ComingUp items={overview.upcoming} commitments={commitments} l={l} today={today} />
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Repeating</h2>
            {commitments.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="font-medium">Nothing repeating yet</p>
                <p className="mt-1 text-sm text-muted">
                  Add rent, bills and money you send every month, to see what&rsquo;s due and keep it out of what&rsquo;s
                  free to spend.
                </p>
                <Link href="/more/planned/new" className={`${buttonClass.primary} mt-4`}>
                  Plan a payment
                </Link>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {active.length > 0 && <CommitmentList commitments={active} l={l} />}
                {inactive.length > 0 && (
                  <div>
                    <h3 className="mb-2 px-1 text-sm font-medium text-muted">Paused or ended</h3>
                    <CommitmentList commitments={inactive} l={l} />
                  </div>
                )}
              </div>
            )}
          </section>

          <Suspense fallback={null}>
            <Suggestions summary={loadingSummary} labels={loadingLabels} history={history} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

// Regular payments found in the entries that aren't planned yet (FR-6).
async function Suggestions({ summary, labels, history }: Loading) {
  const [{ commitments, today }, l, transactions] = await Promise.all([summary, labels.then(lookups), history]);
  const suggestions = detectRecurring(transactions, commitments, today);
  if (suggestions.length === 0) return null;
  return (
    <section>
      <h2 className="text-lg font-semibold">Found in your entries</h2>
      <p className="mt-1 mb-3 text-sm text-muted">These look regular. Add one to track it.</p>
      <Card>
        <ul className="divide-y divide-line">
          {suggestions.map((s) => {
            const name = s.note?.trim() || fallbackName(s, l);
            const params = new URLSearchParams({
              name,
              kind: s.kind,
              amount: String(s.amount),
              account: s.account_id,
              unit: s.unit,
              every: String(s.every),
              first: s.next_due_on,
            });
            if (s.to_account_id) params.set("to", s.to_account_id);
            if (s.subcategory_id) params.set("sub", s.subcategory_id);
            return (
              <li key={s.key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name}</p>
                  <p className="truncate text-sm text-muted">
                    {formatINR(s.amount)} · {describeSchedule({ ...s, first_due_on: s.next_due_on })} ·{" "}
                    {paidWith(s, l)}
                  </p>
                </div>
                <Link
                  href={`/more/planned/new?${params}`}
                  className={`${buttonClass.secondary} shrink-0`}
                  aria-label={`Add ${name}`}
                >
                  Add
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

function CommitmentList({ commitments, l }: { commitments: CommitmentRow[]; l: ReturnType<typeof lookups> }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {commitments.map((c) => (
          <li key={c.id}>
            <Link href={`/more/planned/${c.id}`} className={listItem}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-sm text-muted">{commitmentDetail(c, l)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium tabular-nums">
                  {c.is_variable && <span className="font-normal text-muted">about </span>}
                  {formatINR(c.amount)}
                </p>
                {!(c.unit === "month" && c.every === 1) && (
                  <p className="text-sm text-muted tabular-nums">{formatINR(recurringCost(c.amount, c).monthly)}/mo</p>
                )}
              </div>
              <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
