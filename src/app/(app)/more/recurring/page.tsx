import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { getLabels } from "@/lib/data/entries";
import {
  getBudgetMonthStartDay,
  getDetectionHistory,
  getScheduleTransactions,
  listCommitments,
  type CommitmentRow,
} from "@/lib/data/recurring";
import { describeEntry } from "@/lib/describe-entry";
import { budgetMonthOf, istDate } from "@/lib/finance/dates";
import { detectRecurring } from "@/lib/finance/detection";
import { formatINR } from "@/lib/finance/money";
import { recurringCost, reservedIn } from "@/lib/finance/recurring";
import { dayInSentence, describeSchedule, recurringOverview } from "@/lib/recurring";
import { DueNow } from "./due-now";
import { capitalise, commitmentDetail, dueRows, fallbackName, lookups, paidWith } from "./rows";

export const metadata: Metadata = { title: "Recurring · Paisa" };

const listItem =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]";

// Recurring commitments (FR-6): what's due now, what's coming up, and every
// commitment, with payments found in the history offered as new ones.
export default async function RecurringPage() {
  const [commitments, transactions, history, labels, startDay] = await Promise.all([
    listCommitments(),
    getScheduleTransactions(),
    getDetectionHistory(),
    getLabels(),
    getBudgetMonthStartDay(),
  ]);
  const now = new Date();
  const today = istDate(now);
  const l = lookups(labels);
  const overview = recurringOverview(commitments, transactions, now);
  const month = budgetMonthOf(today, startDay);
  const reserved = reservedIn(commitments, transactions, month, today);
  const suggestions = detectRecurring(history, commitments, today);

  const active = commitments.filter((c) => !c.paused_at && (!c.ends_on || c.ends_on >= today));
  const inactive = commitments.filter((c) => !active.includes(c));

  return (
    <>
      <PageHeader
        title="Recurring"
        back={{ href: "/more", label: "Back to more" }}
        action={
          <Link href="/more/recurring/new" className={buttonClass.secondary}>
            <PlusIcon className="size-5" />
            New
          </Link>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="grid grid-cols-2 gap-4 p-4 md:p-6">
            <div className="min-w-0">
              <p className="text-sm text-muted">Reserved this month</p>
              <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight tabular-nums">{formatINR(reserved)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted">Next 30 days</p>
              <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight tabular-nums">
                {formatINR(overview.upcomingTotal)}
              </p>
            </div>
            <p className="col-span-2 text-sm text-muted">
              Reserved is what&rsquo;s still to pay this month, overdue bills included, so it isn&rsquo;t free to spend.
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
              <Card>
                <ul className="divide-y divide-line">
                  {overview.upcoming.map((u) => {
                    const title = u.entry
                      ? describeEntry({ ...u.entry, note: u.entry.note ?? null }, l.accountById, l.subById).title
                      : (commitments.find((c) => c.id === u.commitment?.id)?.name ?? "");
                    const href = u.entry ? `/entries/${u.entry.id}` : `/more/recurring/${u.commitment!.id}`;
                    return (
                      <li key={`${u.date}|${u.entry?.id ?? u.commitment?.id}`}>
                        <Link href={href} className={listItem}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{title}</p>
                            <p className="truncate text-sm text-muted">
                              {capitalise(dayInSentence(u.date, today))}
                              {u.entry ? " · Planned" : u.commitment?.is_variable ? " · Amount varies" : ""}
                            </p>
                          </div>
                          <p className="shrink-0 font-medium tabular-nums">{formatINR(u.amount)}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Commitments</h2>
            {commitments.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="font-medium">No commitments yet</p>
                <p className="mt-1 text-sm text-muted">
                  Add rent, bills and subscriptions to see what&rsquo;s due and keep money aside for them.
                </p>
                <Link href="/more/recurring/new" className={`${buttonClass.primary} mt-4`}>
                  Add a commitment
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

          {suggestions.length > 0 && (
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
                          href={`/more/recurring/new?${params}`}
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
          )}
        </div>
      </div>
    </>
  );
}

function CommitmentList({ commitments, l }: { commitments: CommitmentRow[]; l: ReturnType<typeof lookups> }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {commitments.map((c) => (
          <li key={c.id}>
            <Link href={`/more/recurring/${c.id}`} className={listItem}>
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
