import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";
import { listTags } from "@/lib/data/categories";
import { describeRange } from "@/lib/entry-filters";
import { istDate } from "@/lib/finance/dates";
import { NewTag } from "./new-tag";

export const metadata: Metadata = { title: "Tags · Paisa" };

// Tags for trips and events, newest first (FR-5).
export default async function TagsPage() {
  const tags = await listTags();
  const today = istDate(new Date());
  return (
    <>
      <PageHeader title="Tags" back={{ href: "/more", label: "Back to more" }} />
      <div className="flex max-w-2xl flex-col gap-5">
        <p className="text-sm text-muted">
          Tag entries for a trip or an event, like &ldquo;Goa Trip&rdquo; or &ldquo;Diwali 2026&rdquo;, to see what it
          cost in all.
        </p>
        <NewTag />
        {tags.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="font-medium">No tags yet</p>
            <p className="mt-1 text-sm text-muted">Create one, then add it to entries on the Add screen.</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <Link
                    href={`/more/tags/${tag.id}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{tag.name}</p>
                      <p className="truncate text-sm text-muted">
                        {tag.entries.toLocaleString("en-IN")} {tag.entries === 1 ? "entry" : "entries"}
                        {tag.starts_on && ` · ${describeRange(tag.starts_on, tag.ends_on ?? undefined, today)}`}
                      </p>
                    </div>
                    <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
