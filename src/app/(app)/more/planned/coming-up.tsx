import Link from "next/link";
import { Card } from "@/components/ui";
import type { CommitmentRow } from "@/lib/data/recurring";
import { describeEntry } from "@/lib/describe-entry";
import { formatINR } from "@/lib/finance/money";
import { dayInSentence, type UpcomingEntry } from "@/lib/recurring";
import { capitalise, type lookups } from "./rows";

const HOW_OFTEN = { week: "Weekly", month: "Monthly", year: "Yearly" };

// Planned payments still to come, soonest first: repeating ones and one-offs.
export function ComingUp({
  items,
  commitments,
  l,
  today,
}: {
  items: UpcomingEntry[];
  commitments: CommitmentRow[];
  l: ReturnType<typeof lookups>;
  today: string;
}) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {items.map((u) => {
          const c = u.commitment ? commitments.find((x) => x.id === u.commitment!.id) : undefined;
          const title = u.entry
            ? describeEntry({ ...u.entry, note: u.entry.note ?? null }, l.accountById, l.subById).title
            : (c?.name ?? "");
          const from = l.accountById.get((u.entry ?? c)?.account_id ?? "")?.name;
          const often = !c ? "Once" : c.every === 1 ? HOW_OFTEN[c.unit] : `Every ${c.every} ${c.unit}s`;
          const href = u.entry ? `/entries/${u.entry.id}` : `/more/planned/${c?.id}`;
          return (
            <li key={`${u.date}|${u.entry?.id ?? u.commitment?.id}`}>
              <Link
                href={href}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{title}</p>
                  <p className="truncate text-sm text-muted">
                    {[capitalise(dayInSentence(u.date, today)), often, from].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 text-right font-medium text-planned tabular-nums">
                  {c?.is_variable && <span className="font-normal text-muted">about </span>}
                  {formatINR(u.amount)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
