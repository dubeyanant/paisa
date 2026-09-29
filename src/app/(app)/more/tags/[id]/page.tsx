import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { getTag } from "@/lib/data/categories";
import { getLabels, getTagSuggestions } from "@/lib/data/entries";
import { getTagReports } from "@/lib/data/tags";
import { describeRange } from "@/lib/entry-filters";
import { istDate } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import type { TagReport } from "@/lib/finance/tags";
import { percent } from "@/lib/home";
import { tagComparison, tagHeadline } from "@/lib/insights";
import { TagForm } from "../tag-form";
import { Suggestions } from "./suggestions";

export const metadata: Metadata = { title: "Tag · Paisa" };

export default async function TagPage({ params }: PageProps<"/more/tags/[id]">) {
  const { id } = await params;
  const [tag, { tags, reports, categoryOf, categoryName, subcategoryName }, labels] = await Promise.all([
    getTag(id),
    getTagReports(),
    getLabels(),
  ]);
  // They need the tag's dates, so they come a moment after the rest.
  const suggestions = tag.starts_on && tag.ends_on ? getTagSuggestions(tag.id, tag.starts_on, tag.ends_on) : null;
  const today = istDate(new Date());
  const report = reports.get(tag.id);
  const category = (id: string) => categoryName.get(id) ?? "Other";
  const comparison = report ? tagComparison(report) : null;
  const others = tags.filter((t) => reports.has(t.id) && reports.get(t.id)!.total > 0);

  return (
    <>
      <PageHeader title={tag.name} back={{ href: "/more/tags", label: "Back to tags" }} />
      {/* On a phone the suggestions come before the form; on a laptop, beside it. */}
      <div className="grid max-w-5xl items-start gap-6 lg:grid-cols-2 lg:gap-8">
        <Card className="p-4 md:p-6 lg:col-start-1">
          <p className="text-sm text-muted">Spent</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatINR(report?.total ?? 0)}</p>
          <p className="mt-1 text-sm text-muted">
            {tag.entries.toLocaleString("en-IN")} {tag.entries === 1 ? "entry" : "entries"}
            {tag.starts_on && ` · ${describeRange(tag.starts_on, tag.ends_on ?? undefined, today)}`}
          </p>
          {report && report.total > 0 && (
            <>
              <p className="mt-3 font-medium">{tagHeadline(tag.name, report, category)}</p>
              {comparison && <p className="mt-3 text-sm text-muted">{comparison}</p>}
            </>
          )}
          {tag.entries > 0 && (
            <Link href={`/entries?tag=${tag.id}`} className={`${buttonClass.secondary} mt-4`}>
              See entries
              <ChevronRightIcon className="-mr-1 size-5" />
            </Link>
          )}
        </Card>

        {suggestions && (
          <Suspense fallback={null}>
            <Suggested tagId={tag.id} suggestions={suggestions} labels={labels} />
          </Suspense>
        )}

        {report && report.total > 0 && (
          <Card className="p-4 md:p-6 lg:col-start-1">
            <h2 className="font-semibold">Where it went</h2>
            <Breakdown
              report={report}
              categoryOf={categoryOf}
              category={category} subcategory={(id) => subcategoryName.get(id) ?? "Other"}
            />
          </Card>
        )}

        {report && report.total > 0 && others.length > 1 && (
          <Card className="p-4 md:p-6 lg:col-start-1">
            <h2 className="font-semibold">Per day, against other tags</h2>
            <Comparison
              current={tag.id}
              rows={others.map((t) => ({ id: t.id, name: t.name, perDay: reports.get(t.id)!.perDay }))}
            />
          </Card>
        )}

        <Card className="p-4 md:p-6 lg:col-start-1">
          <TagForm key={tag.id} tag={tag} />
        </Card>
      </div>
    </>
  );
}

// INS-13 by category, biggest first, each with its subcategories. Refunds are
// netted off (BR-6).
// Entries from the tag's dates that don't have it yet.
async function Suggested({
  tagId,
  suggestions,
  labels,
}: {
  tagId: string;
  suggestions: ReturnType<typeof getTagSuggestions>;
  labels: Awaited<ReturnType<typeof getLabels>>;
}) {
  const entries = await suggestions;
  if (entries.length === 0) return null;
  return (
    <section className="min-w-0 lg:col-start-2 lg:row-span-4 lg:row-start-1">
      <h2 className="text-lg font-semibold">Suggested</h2>
      <p className="mt-1 mb-3 text-sm text-muted">
        Entries from the tag&apos;s dates that don&apos;t have it yet. Choose the ones that belong.
      </p>
      <Suggestions tagId={tagId} entries={entries} {...labels} />
    </section>
  );
}

function Breakdown({
  report,
  categoryOf,
  category,
  subcategory,
}: {
  report: TagReport;
  categoryOf: Map<string, string>;
  category: (id: string) => string;
  subcategory: (id: string) => string;
}) {
  const categories = [...report.byCategory].filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const subsOf = (categoryId: string) =>
    [...report.bySubcategory]
      .filter(([id, v]) => v > 0 && categoryOf.get(id) === categoryId)
      .sort(([, a], [, b]) => b - a);
  return (
    <ul className="mt-3 flex flex-col gap-4">
      {categories.map(([id, amount]) => (
        <li key={id}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-medium">{category(id)}</p>
            <p className="shrink-0 tabular-nums">
              {formatINR(amount)} <span className="text-sm text-muted">{percent(amount / report.total)}</span>
            </p>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden>
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(amount / report.total) * 100}%` }} />
          </div>
          {subsOf(id).length > 1 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
              {subsOf(id).map(([sub, v]) => (
                <li key={sub} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{subcategory(sub)}</span>
                  <span className="shrink-0 tabular-nums">{formatINR(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

// Cost per day of every tag with spending, this one highlighted.
function Comparison({ current, rows }: { current: string; rows: { id: string; name: string; perDay: number }[] }) {
  const sorted = [...rows].sort((a, b) => b.perDay - a.perDay);
  const max = Math.max(sorted[0].perDay, 1);
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {sorted.map((r) => (
        <li key={r.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <p className={`min-w-0 truncate ${r.id === current ? "font-semibold" : ""}`}>{r.name}</p>
            <p className="shrink-0 tabular-nums">{formatINR(r.perDay)}/day</p>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden>
            <div
              className={`h-1.5 rounded-full ${r.id === current ? "bg-accent" : "bg-foreground/25"}`}
              style={{ width: `${(r.perDay / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
