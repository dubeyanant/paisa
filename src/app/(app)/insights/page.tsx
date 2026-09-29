import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";
import { periodLabel } from "@/lib/budget";
import { getInsights } from "@/lib/data/insights";
import { getTagReports } from "@/lib/data/tags";
import type { RecurringPayment } from "@/lib/finance/detection";
import type { CategoryTrend, Pace } from "@/lib/finance/insights";
import { formatINR } from "@/lib/finance/money";
import { percent, times } from "@/lib/home";
import {
  budgetHeadline,
  emergencyHeadline,
  howOften,
  paceHeadline,
  savingsHeadline,
  smallSpendHeadline,
  subscriptionsHeadline,
  tagHeadline,
  trendHeadline,
  upcomingHeadline,
} from "@/lib/insights";
import { fallbackName, lookups } from "../more/planned/rows";
import { SavingsChart } from "./savings-chart";

export const metadata: Metadata = { title: "Insights · Paisa" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// How many categories the pace and trend lists show.
const TOP = 6;

// The Phase 1 insights (FR-8.4, FR-9), each with a plain-language headline and
// a chart or list. Budget adherence (INS-17), upcoming bills (INS-10) and tag
// reports (INS-13) have their own screens, so they show here as headlines that
// link there.
export default async function InsightsPage() {
  const [d, tagData] = await Promise.all([getInsights(), getTagReports()]);
  const l = lookups(d.labels);
  const categoryName = new Map(d.labels.subcategories.map((s) => [s.category_id, s.category]));
  const category = (id: string) => categoryName.get(id) ?? "Other";
  const commitmentName = new Map(d.commitments.map((c) => [c.id, c.name]));
  const paymentName = (p: RecurringPayment) =>
    p.commitment ? (commitmentName.get(p.commitment.id) ?? "A payment") : p.series!.note || fallbackName(p.series!, l);

  // Months before the first entry have nothing to show.
  const savings = d.savings.filter((m) => d.firstDate !== null && m.period.end > d.firstDate);
  const topSmall = d.smallSpends[0];
  // The latest tag with spending (INS-13).
  const latestTag = [...tagData.reports.values()].find((r) => r.total > 0);

  return (
    <>
      <PageHeader title="Insights" />
      <p className="-mt-3 mb-5 text-sm text-muted md:-mt-6 md:mb-8">{periodLabel(d.month)}</p>
      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6">
        <Section title="Savings rate" headline={savingsHeadline(savings.length ? savings : d.savings.slice(-1))}>
          {savings.length > 1 && (
            <>
              <SavingsChart
                points={savings.map((m) => {
                  const [, month, day] = m.period.start.split("-").map(Number);
                  return {
                    label: day === 1 ? MONTHS[month - 1] : `${day} ${MONTHS[month - 1]}`,
                    full: periodLabel(m.period),
                    rate: m.rate,
                    saved: m.saved,
                  };
                })}
              />
              <table className="sr-only">
                <caption>Savings rate by month</caption>
                <tbody>
                  {savings.map((m) => (
                    <tr key={m.period.start}>
                      <th scope="row">{periodLabel(m.period)}</th>
                      <td>{m.rate === null ? "No income" : `${percent(m.rate)}, ${formatINR(m.saved)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>

        <Section
          title="Emergency fund"
          headline={emergencyHeadline(d.emergency, d.accounts.some((a) => a.is_emergency_fund && !a.archived_at))}
        >
          {d.emergency.ready && d.accounts.some((a) => a.is_emergency_fund) && (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted">In the fund</dt>
                <dd className="font-medium tabular-nums">{formatINR(d.emergency.balance)}</dd>
              </div>
              <div>
                <dt className="text-muted">Usual monthly spending</dt>
                <dd className="font-medium tabular-nums">{formatINR(d.emergency.monthlySpending)}</dd>
              </div>
            </dl>
          )}
        </Section>

        <Section title="Spending pace" headline={paceHeadline(d.pace, category)}>
          {d.pace.ready && <PaceList byCategory={d.pace.byCategory} name={category} />}
        </Section>

        <Section title="Categories vs usual" headline={trendHeadline(d.trends, category)}>
          {d.trends.ready && <TrendList byCategory={d.trends.byCategory} name={category} />}
        </Section>

        <Section
          title="Small spends"
          headline={smallSpendHeadline(topSmall, l.subById.get(topSmall?.subcategoryId ?? "")?.name ?? "", d.threshold)}
        >
          {d.smallSpends.length > 0 && (
            <ul className="divide-y divide-line">
              {d.smallSpends.slice(0, 3).map((s) => (
                <li key={s.subcategoryId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.subById.get(s.subcategoryId)?.name ?? "Other"}</p>
                    <p className="text-sm text-muted">
                      {s.count} {s.count === 1 ? "spend" : "spends"} · about {formatINR(s.yearly)} a year
                    </p>
                  </div>
                  <p className="shrink-0 font-medium tabular-nums">{formatINR(s.total)}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted">
            Spends under {formatINR(d.threshold)}.{" "}
            <Link href="/more/settings" className="font-medium text-accent">
              Change
            </Link>
          </p>
        </Section>

        <Section title="Recurring payments" headline={subscriptionsHeadline(d.recurring, paymentName)}>
          {d.recurring.length > 0 && (
            <ul className="divide-y divide-line">
              {d.recurring.map((p) => (
                <li key={p.commitment?.id ?? p.series!.key} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{paymentName(p)}</p>
                    <p className="text-sm text-muted">
                      {[howOften(p.schedule), p.commitment ? null : "Found in your entries"].filter(Boolean).join(" · ")}
                    </p>
                    {p.priceChange && (
                      <p className="text-sm font-medium text-warning tabular-nums">
                        {formatINR(p.priceChange.from)} → {formatINR(p.priceChange.to)}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="font-medium">{formatINR(p.monthly)}/mo</p>
                    <p className="text-sm text-muted">{formatINR(p.yearly)}/yr</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <LinkSection
          href="/more/planned"
          title="Coming up"
          headline={upcomingHeadline(d.upcoming.items, d.today)}
        />
        {d.budget && <LinkSection href="/budget" title="Budget" headline={budgetHeadline(d.budget.buckets)} />}
        <LinkSection
          href={latestTag ? `/more/tags/${latestTag.tagId}` : "/more/tags"}
          title="Trips and tags"
          headline={
            latestTag
              ? tagHeadline(tagData.tags.find((t) => t.id === latestTag.tagId)?.name ?? "Latest tag", latestTag, category)
              : "Tag a trip or an event to see what it cost."
          }
        />
      </div>
    </>
  );
}

function Section({ title, headline, children }: { title: string; headline: string; children?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-6">
      <div>
        <h2 className="text-sm text-muted">{title}</h2>
        <p className="mt-1 font-medium">{headline}</p>
      </div>
      {children}
    </Card>
  );
}

function LinkSection({ href, title, headline }: { href: string; title: string; headline: string }) {
  return (
    <Link href={href} className="block rounded-2xl">
      <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-foreground/[0.03] md:p-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm text-muted">{title}</h2>
          <p className="mt-1 font-medium">{headline}</p>
        </div>
        <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
      </Card>
    </Link>
  );
}

// INS-04 by category: spent so far against a usual month. The bar is the share
// of a usual month spent; the tick is where a usual month is by today.
function PaceList({ byCategory, name }: { byCategory: Map<string, Pace>; name: (id: string) => string }) {
  const rows = [...byCategory].filter(([, p]) => p.spent > 0).sort(([, a], [, b]) => b.spent - a.spent);
  if (rows.length === 0) return null;
  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.slice(0, TOP).map(([id, p]) => {
          const scale = Math.max(p.typical, p.spent, 1);
          return (
            <li key={id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <p className="min-w-0 truncate font-medium">{name(id)}</p>
                <p className="shrink-0 tabular-nums">
                  {formatINR(p.spent)}{" "}
                  <span className={p.runningHot ? "font-medium text-negative" : "text-muted"}>
                    {p.shareOfTypical === null ? "new" : `${percent(p.shareOfTypical)} of usual`}
                  </span>
                </p>
              </div>
              <div className="relative mt-1.5 h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden>
                <div
                  className={`h-1.5 rounded-full ${p.runningHot ? "bg-negative" : "bg-accent"}`}
                  style={{ width: `${(p.spent / scale) * 100}%` }}
                />
                {p.typical > 0 && (
                  <div
                    className="absolute -top-1 h-3.5 w-0.5 rounded bg-foreground/50"
                    style={{ left: `calc(${(p.expected / scale) * 100}% - 1px)` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        The mark is where a usual month is by today.{rows.length > TOP ? ` Top ${TOP} of ${rows.length} categories.` : ""}
      </p>
    </>
  );
}

// INS-05: each category this month against its usual, with its last 6 months.
function TrendList({ byCategory, name }: { byCategory: Map<string, CategoryTrend>; name: (id: string) => string }) {
  const rows = [...byCategory]
    .filter(([, t]) => t.thisMonth > 0 || t.typical > 0)
    .sort(([, a], [, b]) => Number(b.flagged) - Number(a.flagged) || b.thisMonth - a.thisMonth);
  if (rows.length === 0) return null;
  return (
    <>
      <ul className="divide-y divide-line">
        {rows.slice(0, TOP).map(([id, t]) => {
          const max = Math.max(...t.history, 1);
          return (
            <li key={id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{name(id)}</p>
                <p className="text-sm text-muted tabular-nums">
                  {formatINR(t.thisMonth)} · usual {formatINR(t.typical)}
                  {t.multiple !== null && t.flagged && (
                    <span className="font-medium text-negative"> · {times(t.multiple)}</span>
                  )}
                </p>
              </div>
              {/* The last 6 months, this one darkest. */}
              <div className="flex h-8 w-20 shrink-0 items-end gap-0.5" aria-hidden>
                {t.history.map((v, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm ${i === t.history.length - 1 ? (t.flagged ? "bg-negative" : "bg-accent") : "bg-foreground/20"}`}
                    style={{ height: `${Math.max((v / max) * 100, v > 0 ? 6 : 2)}%` }}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > TOP && <p className="text-sm text-muted">Top {TOP} of {rows.length} categories.</p>}
    </>
  );
}
