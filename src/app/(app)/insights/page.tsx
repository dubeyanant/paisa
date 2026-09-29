import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";
import { periodLabel } from "@/lib/budget";
import { getInsights } from "@/lib/data/insights";
import { getTagReports } from "@/lib/data/tags";
import type { RecurringPayment } from "@/lib/finance/detection";
import type { CategoryTrend, Pace } from "@/lib/finance/insights";
import { hotEnough } from "@/lib/finance/alerts";
import { addDays } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import { filtersQuery } from "@/lib/entry-filters";
import { percent, times } from "@/lib/home";
import {
  budgetHeadline,
  committedHeadline,
  emergencyHeadline,
  howOften,
  paceHeadline,
  savingsHeadline,
  sensibleRate,
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

  // A payment set up in Planned opens there; one found in the entries shows
  // its payments.
  const paymentHref = (p: RecurringPayment) => {
    if (p.commitment) return `/more/planned/${p.commitment.id}`;
    const s = p.series!;
    return `/entries?${filtersQuery(
      s.kind === "expense"
        ? { subcategory: s.subcategory_id ?? undefined, kind: "expense", q: s.note ?? undefined }
        : { account: s.account_id, kind: "transfer", q: s.note ?? undefined },
    )}`;
  };
  // Tapping a category shows its expenses this month.
  const categoryEntries = (id: string) =>
    `/entries?${filtersQuery({ from: d.month.start, to: d.today, kind: "expense", category: id })}`;

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
        <Section title="Saved each month" headline={savingsHeadline(savings)}>
          {savings.length > 1 && (
            <SavingsChart
              points={savings.map((m) => {
                const [, month, day] = m.period.start.split("-").map(Number);
                return {
                  label: day === 1 ? MONTHS[month - 1] : `${day} ${MONTHS[month - 1]}`,
                  full: periodLabel(m.period),
                  saved: m.saved,
                };
              })}
            />
          )}
          {savings.length > 0 && (
            <ul className="divide-y divide-line">
              {[...savings].reverse().map((m) => {
                const rate = sensibleRate(m);
                return (
                  <li key={m.period.start} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{periodLabel(m.period)}</p>
                      <p className="text-sm text-muted tabular-nums">
                        Earned {formatINR(m.income)} · spent {formatINR(m.spending)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className={`font-medium ${m.saved < 0 ? "text-negative" : ""}`}>{formatINR(m.saved)}</p>
                      {rate !== null && <p className="text-sm text-muted">{percent(rate)}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm text-muted">Saved is what you earned minus what you spent. This month shows once it&rsquo;s over.</p>
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

        <Section title="Everyday spending pace" headline={paceHeadline(d.pace, category)}>
          {d.pace.ready && <PaceList byCategory={d.pace.byCategory} name={category} href={categoryEntries} />}
        </Section>

        <Section title="Categories vs usual" headline={trendHeadline(d.trends, category)}>
          {d.trends.ready && <TrendList byCategory={d.trends.byCategory} name={category} href={categoryEntries} />}
        </Section>

        <Section
          title="Small spends"
          headline={smallSpendHeadline(topSmall, l.subById.get(topSmall?.subcategoryId ?? "")?.name ?? "", d.threshold)}
        >
          {d.smallSpends.length > 0 && (
            <ul className="-mx-2 divide-y divide-line">
              {d.smallSpends.slice(0, 3).map((s) => (
                <li key={s.subcategoryId}>
                  <Link
                    href={`/entries?${filtersQuery({
                      from: addDays(d.today, -29),
                      to: d.today,
                      kind: "expense",
                      subcategory: s.subcategoryId,
                      max: d.threshold - 1,
                    })}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-foreground/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.subById.get(s.subcategoryId)?.name ?? "Other"}</p>
                      <p className="text-sm text-muted">
                        {s.count} {s.count === 1 ? "spend" : "spends"} · about {formatINR(s.yearly)} a year
                      </p>
                    </div>
                    <p className="shrink-0 font-medium tabular-nums">{formatINR(s.total)}</p>
                    <ChevronRightIcon className="-mr-1 size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted">
            Spends under {formatINR(d.threshold)} in the last 30 days.{" "}
            <Link href="/more/settings" className="font-medium text-accent">
              Change
            </Link>
          </p>
        </Section>

        <Section title="Recurring payments" headline={subscriptionsHeadline(d.recurring, paymentName)}>
          {d.recurring.length > 0 && (
            <ul className="-mx-2 divide-y divide-line">
              {d.recurring.map((p) => (
                <li key={p.commitment?.id ?? p.series!.key}>
                  <Link href={paymentHref(p)} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-foreground/[0.03]">
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
                    <ChevronRightIcon className="-mr-1 size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Income and planned payments" headline={committedHeadline(d.free)} />

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

// INS-04 by category: everyday spending so far against a usual month. The bar
// is the share of a usual month spent; the mark is where a usual month is by
// today. Red only when it's ahead by enough to matter (hotEnough()).
function PaceList({
  byCategory,
  name,
  href,
}: {
  byCategory: Map<string, Pace>;
  name: (id: string) => string;
  href: (id: string) => string;
}) {
  const rows = [...byCategory].filter(([, p]) => p.spent > 0).sort(([, a], [, b]) => b.spent - a.spent);
  if (rows.length === 0) return null;
  return (
    <>
      <ul className="-mx-2 flex flex-col">
        {rows.slice(0, TOP).map(([id, p]) => {
          const scale = Math.max(p.typical, p.spent, 1);
          const hot = hotEnough(p);
          return (
            <li key={id}>
              <Link href={href(id)} className="block rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.03]">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-medium">{name(id)}</p>
                  <p className="flex shrink-0 items-center gap-1 font-medium tabular-nums">
                    {formatINR(p.spent)}
                    <ChevronRightIcon className="-mr-1 size-4 text-muted" />
                  </p>
                </div>
                <p className="text-sm text-muted tabular-nums">
                  {p.typical > 0 ? `A usual month: ${formatINR(p.typical)}` : "Nothing in a usual month"}
                  {p.shareOfTypical !== null && (
                    <span className={hot ? "font-medium text-negative" : undefined}>
                      {" "}
                      · {percent(p.shareOfTypical)} spent
                    </span>
                  )}
                </p>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden>
                  <div
                    className={`h-1.5 rounded-full ${hot ? "bg-negative" : "bg-accent"}`}
                    style={{ width: `${(p.spent / scale) * 100}%` }}
                  />
                  {p.typical > 0 && (
                    <div
                      className="absolute -top-1 h-3.5 w-0.5 rounded bg-foreground/50"
                      style={{ left: `calc(${(p.expected / scale) * 100}% - 1px)` }}
                    />
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        The mark is where a usual month is by today. Planned payments like rent and bills aren&rsquo;t counted here.
        Tap a category to see its entries.
        {rows.length > TOP ? ` Top ${TOP} of ${rows.length} categories.` : ""}
      </p>
    </>
  );
}

// INS-05: each category this month against its usual, with its last 6 months.
function TrendList({
  byCategory,
  name,
  href,
}: {
  byCategory: Map<string, CategoryTrend>;
  name: (id: string) => string;
  href: (id: string) => string;
}) {
  const rows = [...byCategory]
    .filter(([, t]) => t.thisMonth > 0 || t.typical > 0)
    .sort(([, a], [, b]) => Number(b.flagged) - Number(a.flagged) || b.thisMonth - a.thisMonth);
  if (rows.length === 0) return null;
  return (
    <>
      <ul className="-mx-2 divide-y divide-line">
        {rows.slice(0, TOP).map(([id, t]) => {
          const max = Math.max(...t.history, 1);
          return (
            <li key={id}>
              <Link href={href(id)} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-foreground/[0.03]">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name(id)}</p>
                  <p className="text-sm text-muted tabular-nums">
                    {formatINR(t.thisMonth)} so far · usual {formatINR(t.typical)}
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
                <ChevronRightIcon className="-mr-1 size-4 shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.length > TOP && <p className="text-sm text-muted">Top {TOP} of {rows.length} categories.</p>}
    </>
  );
}
