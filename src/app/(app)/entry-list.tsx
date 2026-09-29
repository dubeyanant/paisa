import Link from "next/link";
import { Card } from "@/components/ui";
import type { AccountOption, Entry, SubcategoryOption } from "@/lib/data/entries";
import { describeEntry, istDayLabel, istTime } from "@/lib/describe-entry";
import { istDate } from "@/lib/finance/dates";
import { formatINR } from "@/lib/finance/money";

// Entries grouped by IST day, newest first. Tapping one opens it to edit,
// duplicate or delete (FR-2).
export function EntryList({
  entries,
  accounts,
  subcategories,
  showPlanned = false,
}: {
  entries: Entry[];
  accounts: AccountOption[];
  subcategories: SubcategoryOption[];
  // Marks planned entries, where they aren't already in a list of their own.
  showPlanned?: boolean;
}) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));
  const days: { day: string; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const day = istDate(entry.occurred_at);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(entry);
  }

  return (
    <div className="flex flex-col gap-5">
      {days.map(({ day, entries }) => (
        <section key={day}>
          <h3 className="mb-2 px-1 text-sm font-medium text-muted">{istDayLabel(entries[0].occurred_at)}</h3>
          <Card>
            <ul className="divide-y divide-line">
              {entries.map((entry) => {
                const d = describeEntry(entry, accountById, subById);
                return (
                  <li key={entry.id}>
                    <Link
                      href={`/entries/${entry.id}`}
                      className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium">
                          <span className="truncate">{d.title}</span>
                          {showPlanned && entry.is_planned && (
                            <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-xs font-medium text-muted">
                              Planned
                            </span>
                          )}
                        </p>
                        <p className="truncate text-sm text-muted">
                          {istTime(entry.occurred_at)} · {d.detail}
                        </p>
                      </div>
                      <p
                        className={`shrink-0 text-right font-medium tabular-nums ${
                          d.direction === "in" ? "text-accent" : d.direction === "move" ? "text-muted" : ""
                        }`}
                      >
                        {d.direction === "in" ? "+" : d.direction === "out" ? "−" : ""}
                        {formatINR(Math.abs(d.amount))}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
