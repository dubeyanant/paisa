import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";
import { isUuid } from "@/lib/data/accounts";
import { getActiveRule } from "@/lib/data/budget";
import { getLabels } from "@/lib/data/entries";
import { getMoneySummary } from "@/lib/data/summary";
import { budgetMonthOf, istDate, istStartOf } from "@/lib/finance/dates";
import { balanceBefore, type FundEvent } from "@/lib/finance/funds";
import { formatINR } from "@/lib/finance/money";
import { boughtWith, fundDetail, monthChoices, monthName } from "@/lib/funds";
import { dayInSentence } from "@/lib/recurring";
import { CloseOrDelete, MoveMoney } from "../fund-actions";
import { FundForm } from "../fund-form";
import { capitalise } from "../../rows";

export const metadata: Metadata = { title: "Fund · Paisa" };

// A fund (TD-21): what it holds, adding or taking out money, what it paid
// for, and changing it.
export default async function FundPage({ params }: PageProps<"/more/planned/funds/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [{ funds, month, today, startDay }, rule, labels] = await Promise.all([getMoneySummary(), getActiveRule(), getLabels()]);
  const state = funds.find((s) => s.fund.id === id);
  if (!state) notFound();
  const { fund } = state;
  const open = !state.closedAt;
  const goal = fund.kind === "goal";
  const started = budgetMonthOf(fund.schedule_from, startDay).start <= month.start;
  const bucket = rule?.buckets.find((b) => b.id === fund.bucket_id)?.name;
  const subById = new Map(labels.subcategories.map((s) => [s.id, s.name]));
  const paidFor = state.events.some((e) => e.type === "spend");
  const progress = goal && fund.target ? Math.min(state.balance / fund.target, 1) : 0;
  // For the form's preview: held before this month's share, and added since.
  const before = balanceBefore(state, istStartOf(month.start));
  const status = state.closedAt
    ? `${boughtWith(state) ? "Bought" : "Closed"} ${dayInSentence(istDate(state.closedAt), today)}`
    : fundDetail(state, startDay);

  return (
    <>
      <PageHeader title={fund.name} back={{ href: "/more/planned", label: "Back to planned" }} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="p-4 md:p-6">
            <p className="text-sm text-muted">{open ? "Held for it" : "Held"}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              <span className={open ? "text-planned" : ""}>{formatINR(state.balance)}</span>
              {goal && open && <span className="text-base font-normal text-muted"> of {formatINR(fund.target ?? 0)}</span>}
            </p>
            {goal && open && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
                <div className="h-full rounded-full bg-planned" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <p className="mt-3 text-sm text-muted">
              {capitalise(status)}
              {goal && open && state.monthsLeft > 0 && ` · until ${monthName(budgetMonthOf(fund.ends_on!, startDay))}`}
              {bucket && ` · counts in ${bucket}`}
            </p>
            {open && (
              <p className="mt-3 text-sm text-muted">
                The money stays in your bank, but isn&rsquo;t counted as free to spend. To pay from it, choose{" "}
                <span className="font-medium text-foreground">From fund</span> when you add the expense.
              </p>
            )}
          </Card>

          {open && <MoveMoney fundId={fund.id} balance={state.balance} />}

          {open && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Change</h2>
              <FundForm
                key={JSON.stringify(fund)}
                fund={fund}
                balance={state.balance}
                before={before}
                extra={state.balance - before - state.thisMonth}
                started={started}
                buckets={rule?.buckets ?? []}
                months={monthChoices(month)}
              />
            </section>
          )}

          <CloseOrDelete fundId={fund.id} balance={state.balance} open={open} canDelete={!paidFor} />
        </div>

        <section className="min-w-0">
          <h2 className="mb-3 text-lg font-semibold">History</h2>
          {state.events.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted">
              {goal && !started ? `Saving starts ${monthName(budgetMonthOf(fund.schedule_from, startDay))}.` : "Nothing yet."}
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {[...state.events].reverse().map((e, i) => (
                  <HistoryRow key={i} e={e} today={today} startDay={startDay} subById={subById} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

function HistoryRow({
  e,
  today,
  startDay,
  subById,
}: {
  e: FundEvent;
  today: string;
  startDay: number;
  subById: Map<string, string>;
}) {
  const day = istDate(e.at);
  if (e.type === "spend") {
    const t = e.transaction;
    const refund = t.kind === "refund";
    const extra = t.amount - Math.abs(e.covered);
    return (
      <li>
        <Link href={`/entries/${t.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-foreground/[0.03]">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {refund ? "Refund: " : ""}
              {t.note?.trim() || subById.get(t.subcategory_id ?? "") || "Expense"}
            </p>
            <p className="truncate text-sm text-muted">
              {capitalise(dayInSentence(day, today))}
              {e.covered === 0
                ? " · after it closed, so counted as usual"
                : extra > 0 && ` · ${formatINR(extra)} more counted as usual`}
            </p>
          </div>
          <p className="shrink-0 font-medium tabular-nums">
            {e.covered > 0 ? "−" : e.covered < 0 ? "+" : ""}
            {formatINR(Math.abs(e.covered))}
          </p>
          <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
        </Link>
      </li>
    );
  }
  const title =
    e.type === "release"
      ? "Left over, free to spend again"
      : e.type === "monthly" || e.is_monthly
        ? `For ${monthName(budgetMonthOf(day, startDay))}`
        : e.amount > 0
          ? "Added"
          : "Taken out";
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-sm text-muted">{capitalise(dayInSentence(day, today))}</p>
      </div>
      <p className="shrink-0 font-medium tabular-nums">
        {e.amount > 0 ? "+" : "−"}
        {formatINR(Math.abs(e.amount))}
      </p>
    </li>
  );
}
