import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { listAccounts } from "@/lib/data/accounts";
import { getActiveRule, getFirstEntryDate, getTransactionsBetween } from "@/lib/data/budget";
import { getBudgetMonthStartDay } from "@/lib/data/recurring";
import { formatShare, periodLabel, statusLabel, streakLabel } from "@/lib/budget";
import { budgetAdherence, type BucketAdherence } from "@/lib/finance/budget";
import { budgetMonthOf, daysElapsed, istDate, periodLength, shiftBudgetMonth } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";

export const metadata: Metadata = { title: "Budget · Paisa" };

const HISTORY_MONTHS = 6;

// The budget rule this month (FR-7, INS-17): each bucket's target, actual,
// what's left and pace, and how the last months went.
export default async function BudgetPage() {
  const today = istDate(new Date());
  const [rule, accounts, startDay, firstEntry] = await Promise.all([
    getActiveRule(),
    listAccounts(),
    getBudgetMonthStartDay(),
    getFirstEntryDate(),
  ]);
  const month = budgetMonthOf(today, startDay);

  if (!rule) {
    return (
      <>
        <PageHeader title="Budget" back={{ href: "/more", label: "Back to more" }} />
        <Card className="p-6 text-center">
          <p className="font-medium">No budget rule yet</p>
          <Link href="/budget/rule" className={`${buttonClass.primary} mt-4`}>
            Set up a rule
          </Link>
        </Card>
      </>
    );
  }

  const transactions = await getTransactionsBetween(shiftBudgetMonth(month, -HISTORY_MONTHS), month);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const { base, buckets, unassigned } = budgetAdherence(transactions, rule, accountsById, month, today, HISTORY_MONTHS);
  // Months before the first entry have nothing to judge.
  const firstDate = firstEntry ? istDate(firstEntry) : null;
  const judged = (end: string) => firstDate !== null && end > firstDate;
  const historyPeriods = (buckets[0]?.history ?? []).map((h) => h.period).filter((p) => judged(p.end));
  const daysLeft = periodLength(month) - daysElapsed(month, today);

  return (
    <>
      <PageHeader
        title="Budget"
        back={{ href: "/more", label: "Back to more" }}
        action={
          <Link href="/budget/rule" className={buttonClass.secondary}>
            Edit rule
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        <Card className="p-4 md:p-6">
          <p className="text-sm text-muted">
            {periodLabel(month)} · {daysLeft === 0 ? "Last day" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatINR(base)}</p>
          <p className="mt-1 text-sm text-muted">
            {rule.base === "fixed" ? "The fixed amount" : "Income so far this month"} that {rule.name} divides:{" "}
            {rule.buckets.map((b) => `${b.name} ${formatShare(b.share_bp)}`).join(", ")}.
          </p>
          {base === 0 && rule.base === "income" && (
            <p className="mt-3 text-sm text-muted">No income yet this month, so every target is ₹0 until it comes in.</p>
          )}
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buckets.map((b) => (
            <BucketCard key={b.bucket.id} b={b} elapsed={daysElapsed(month, today) / periodLength(month)} />
          ))}
        </div>

        {unassigned !== 0 && (
          <Card className="p-4 text-sm">
            <span className="font-medium tabular-nums">{formatINR(unassigned)}</span> went on categories without a
            bucket this month.{" "}
            <Link href="/more/categories" className="font-medium text-accent">
              Choose their buckets
            </Link>
          </Card>
        )}

        {historyPeriods.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-semibold">Last {historyPeriods.length} months</h2>
            <History buckets={buckets} periods={historyPeriods.map((p) => p.start)} />
          </section>
        )}
      </div>
    </>
  );
}

const STATUS_STYLE = {
  on_track: "bg-accent-soft text-accent",
  at_risk: "bg-warning/15 text-warning",
  over: "bg-negative/10 text-negative",
};

function BucketCard({ b, elapsed }: { b: BucketAdherence; elapsed: number }) {
  const savings = b.bucket.holds_savings;
  const filled = b.target > 0 ? Math.min(b.actual / b.target, 1) : b.actual > 0 ? 1 : 0;
  const streak = streakLabel(b);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{b.bucket.name}</h3>
          <p className="text-sm text-muted">{formatShare(b.bucket.share_bp)} target</p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[b.status]}`}>
          {statusLabel(b)}
        </span>
      </div>
      <div>
        <p className="tabular-nums">
          <span className="text-xl font-semibold">{formatINR(b.actual)}</span>{" "}
          <span className="text-sm text-muted">
            {savings ? "saved" : "spent"} of {formatINR(b.target)}
          </span>
        </p>
        {/* The bar is how much of the target is used; the tick is how much of the month has gone. */}
        <div className="relative mt-2 h-2 rounded-full bg-foreground/[0.08]" aria-hidden>
          <div
            className={`h-2 rounded-full ${b.status === "over" ? "bg-negative" : b.status === "at_risk" ? "bg-warning" : "bg-accent"}`}
            style={{ width: `${filled * 100}%` }}
          />
          <div className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/40" style={{ left: `calc(${elapsed * 100}% - 1px)` }} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">{b.remaining >= 0 ? (savings ? "Still to save" : "Left") : savings ? "Ahead by" : "Over by"}</dt>
          <dd className="font-medium tabular-nums">{formatINR(Math.abs(b.remaining))}</dd>
        </div>
        <div>
          <dt className="text-muted">Of the base</dt>
          <dd className="font-medium tabular-nums">
            {b.shareOfBase === null ? "–" : formatShare(Math.round(b.shareOfBase * 10000))}
          </dd>
        </div>
      </dl>
      {streak && <p className="text-sm font-medium text-negative">{streak}</p>}
    </Card>
  );
}

// Month by month against target. The full table on larger screens; on a phone,
// a row of marks per bucket (on target or not).
function History({ buckets, periods }: { buckets: BucketAdherence[]; periods: string[] }) {
  const rows = (b: BucketAdherence) => b.history.filter((h) => periods.includes(h.period.start));
  return (
    <>
      <Card className="md:hidden">
        <ul className="divide-y divide-line">
          {buckets.map((b) => {
            const history = rows(b);
            const hits = history.filter((h) => h.onTarget).length;
            return (
              <li key={b.bucket.id} className="flex items-center gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 truncate font-medium">{b.bucket.name}</p>
                <div className="flex gap-1" aria-hidden>
                  {history.map((h) => (
                    <span key={h.period.start} className={`size-3 rounded-sm ${h.onTarget ? "bg-accent" : "bg-negative"}`} />
                  ))}
                </div>
                <p className="shrink-0 text-right text-sm whitespace-nowrap text-muted tabular-nums">
                  {hits} of {history.length}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-4 py-3 text-sm text-muted">
          Months on target, oldest first. The full table is on a larger screen.
        </p>
      </Card>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-4 py-3 font-medium">Month</th>
              {buckets.map((b) => (
                <th key={b.bucket.id} className="px-4 py-3 text-right font-medium">
                  {b.bucket.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...periods].reverse().map((start) => (
              <tr key={start}>
                <td className="px-4 py-3 font-medium">{periodLabel(buckets[0].history.find((h) => h.period.start === start)!.period, true)}</td>
                {buckets.map((b) => {
                  const h = b.history.find((x) => x.period.start === start)!;
                  return (
                    <td key={b.bucket.id} className="px-4 py-3 text-right">
                      <span className={h.onTarget ? "" : "font-medium text-negative"}>{formatINR(h.actual)}</span>
                      <span className="block text-xs text-muted">of {formatINR(h.target)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
