import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Card } from "@/components/ui";
import type { FundRowState } from "@/lib/data/funds";
import { formatINR } from "@/lib/finance/money";
import { fundDetail } from "@/lib/funds";

const listItem =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]";

// Funds (TD-21), each opening its own screen: what it holds and, for a target
// fund nothing's been spent from, its target. On Planned and on Home.
export function FundList({ funds, startDay }: { funds: FundRowState[]; startDay: number }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {funds.map((s) => (
          <li key={s.fund.id}>
            <Link href={`/more/planned/funds/${s.fund.id}`} className={listItem}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.fund.name}</p>
                <p className="truncate text-sm text-muted">{fundDetail(s, startDay)}</p>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className={`font-medium ${s.closedAt ? "text-muted" : ""}`}>{formatINR(s.balance)}</p>
                {s.fund.kind === "goal" && !s.closedAt && s.spent === 0 && (
                  <p className="text-sm text-muted">of {formatINR(s.fund.target ?? 0)}</p>
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
