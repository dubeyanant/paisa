import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { Amount, Card, PageHeader } from "@/components/ui";
import { listAccounts } from "@/lib/data/accounts";
import { balanceSummary } from "@/lib/finance/balances";

// A first Home: where the money is. Insights arrive in roadmap step 9.
export default async function Home() {
  const accounts = await listAccounts();
  const summary = balanceSummary(accounts, new Map(accounts.map((a) => [a.id, a.balance])));

  return (
    <>
      <PageHeader title="Paisa" />
      <Link href="/accounts" className="block max-w-xl rounded-2xl">
        <Card className="p-4 transition-colors hover:bg-foreground/[0.03] md:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Available in bank and cash</p>
            <ChevronRightIcon className="-mr-1 size-5 text-muted" />
          </div>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            <Amount value={summary.available} />
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
            <div className="min-w-0">
              <dt className="text-sm text-muted">Card dues</dt>
              <dd className="truncate font-medium tabular-nums">
                <Amount value={summary.cardDues} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm text-muted">Net position</dt>
              <dd className="truncate font-medium tabular-nums">
                <Amount value={summary.netPosition} />
              </dd>
            </div>
          </dl>
        </Card>
      </Link>
    </>
  );
}
