import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { getTag } from "@/lib/data/categories";
import { getEntryTotals, getLabels, getTagSuggestions } from "@/lib/data/entries";
import { describeRange } from "@/lib/entry-filters";
import { istDate } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";
import { TagForm } from "../tag-form";
import { Suggestions } from "./suggestions";

export const metadata: Metadata = { title: "Tag · Paisa" };

export default async function TagPage({ params }: PageProps<"/more/tags/[id]">) {
  const { id } = await params;
  const tag = await getTag(id);
  const [totals, labels, suggestions] = await Promise.all([
    getEntryTotals({ tag: tag.id }),
    getLabels(),
    tag.starts_on && tag.ends_on ? getTagSuggestions(tag.id, tag.starts_on, tag.ends_on) : [],
  ]);
  const today = istDate(new Date());

  return (
    <>
      <PageHeader title={tag.name} back={{ href: "/more/tags", label: "Back to tags" }} />
      {/* On a phone the suggestions come before the form; on a laptop, beside it. */}
      <div className="grid max-w-5xl items-start gap-6 lg:grid-cols-2 lg:gap-8">
        <Card className="p-4 md:p-6 lg:col-start-1">
          <p className="text-sm text-muted">Spent</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatINR(totals.spending)}</p>
          <p className="mt-1 text-sm text-muted">
            {totals.entries.toLocaleString("en-IN")} {totals.entries === 1 ? "entry" : "entries"}
            {tag.starts_on && ` · ${describeRange(tag.starts_on, tag.ends_on ?? undefined, today)}`}
          </p>
          {totals.entries > 0 && (
            <Link href={`/entries?tag=${tag.id}`} className={`${buttonClass.secondary} mt-4`}>
              See entries
              <ChevronRightIcon className="-mr-1 size-5" />
            </Link>
          )}
        </Card>

        {suggestions.length > 0 && (
          <section className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <h2 className="text-lg font-semibold">Suggested</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              Entries from the tag&apos;s dates that don&apos;t have it yet. Choose the ones that belong.
            </p>
            <Suggestions tagId={tag.id} entries={suggestions} {...labels} />
          </section>
        )}

        <Card className="p-4 md:p-6 lg:col-start-1">
          <TagForm key={tag.id} tag={tag} />
        </Card>
      </div>
    </>
  );
}
