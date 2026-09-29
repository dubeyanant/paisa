import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Amount, Card, PageHeader, buttonClass } from "@/components/ui";
import { ACCOUNT_TYPES, isOwedType, ordinal } from "@/lib/accounts";
import { listAccounts, type AccountWithBalance } from "@/lib/data/accounts";
import { balanceSummary, cardOutstanding } from "@/lib/finance/balances";
import { formatINR } from "@/lib/finance/money";

export const metadata: Metadata = { title: "Accounts · Paisa" };

export default async function AccountsPage() {
  const accounts = await listAccounts();
  // Archived accounts still hold money (or debt), so they count in the summary.
  const summary = balanceSummary(accounts, new Map(accounts.map((a) => [a.id, a.balance])));
  const active = accounts.filter((a) => !a.archived_at);
  const archived = accounts.filter((a) => a.archived_at);

  // A figure of ₹0 says nothing, so it isn't shown (TD-18).
  const tiles = [
    { label: "Bank and cash", hint: "Blocked included", value: summary.available },
    { label: "Blocked", hint: "Set aside to spend", value: summary.blocked },
    { label: "Card dues", hint: "Owed on cards", value: summary.cardDues },
    { label: "Card credit", hint: "In your favour", value: summary.cardCredit },
    { label: "Savings", hint: "Savings and investments", value: summary.savings },
    { label: "Deposits", hint: "Comes back later", value: summary.deposits },
    { label: "Loans", hint: "Still owed", value: summary.loansOwed },
    { label: "Net position", hint: "All you have, minus all you owe", value: summary.netPosition },
  ].filter((t) => t.value !== 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        action={
          <Link href="/accounts/new" className={buttonClass.secondary}>
            <PlusIcon className="size-5" />
            <span className="max-[359px]:sr-only">Add account</span>
          </Link>
        }
      />

      <Card className="p-4 md:p-6">
        <p className="text-sm text-muted">Available to spend</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums md:text-4xl">
          <Amount value={summary.spendable} />
        </p>
        <p className="mt-1 text-sm text-muted">Bank and cash, minus blocked money and card dues.</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0">
              <dt className="text-sm text-muted">{tile.label}</dt>
              <dd className="mt-0.5 truncate text-lg font-medium tabular-nums">
                <Amount value={tile.value} />
              </dd>
              <dd className="text-xs text-muted">{tile.hint}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {accounts.length === 0 ? (
        <Card className="mt-6 p-6 text-center">
          <p className="font-medium">No accounts yet</p>
          <p className="mt-1 text-sm text-muted">
            Add the bank account you spend from most, then cards, cash and savings.
          </p>
          <Link href="/accounts/new" className={`${buttonClass.primary} mt-4`}>
            Add account
          </Link>
        </Card>
      ) : (
        <div className="mt-6 gap-6 lg:columns-2">
          {ACCOUNT_TYPES.map(({ type, group }) => {
            const inGroup = active.filter((a) => a.type === type);
            if (inGroup.length === 0) return null;
            return <AccountGroup key={type} title={group} accounts={inGroup} />;
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details className="group mt-2">
          <summary className="flex h-11 w-fit cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
            Archived ({archived.length})
          </summary>
          <p className="mb-3 text-sm text-muted">
            Hidden when adding entries. Their history stays in every report.
          </p>
          <div className="lg:w-1/2 lg:pr-3">
            <AccountGroup accounts={archived} />
          </div>
        </details>
      )}
    </>
  );
}

function AccountGroup({ title, accounts }: { title?: string; accounts: AccountWithBalance[] }) {
  return (
    <section className="mb-6 break-inside-avoid">
      {title && <h2 className="mb-2 px-1 text-sm font-medium text-muted">{title}</h2>}
      <Card>
        <ul className="divide-y divide-line">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountRow account={account} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function AccountRow({ account }: { account: AccountWithBalance }) {
  const details = [];
  if (account.is_emergency_fund) details.push("Emergency fund");
  if (account.is_blocked) details.push("Blocked");
  if (account.statement_day) details.push(`Statement on the ${ordinal(account.statement_day)}`);
  if (account.due_day) details.push(`Due on the ${ordinal(account.due_day)}`);

  return (
    <Link
      href={`/accounts/${account.id}`}
      className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/[0.03]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{account.name}</p>
        {details.length > 0 && <p className="text-sm text-muted">{details.join(" · ")}</p>}
      </div>
      <Balance account={account} />
      <ChevronRightIcon className="-mr-1 size-5 shrink-0 text-muted" />
    </Link>
  );
}

// A card or loan shows what's owed; everything else shows its balance.
function Balance({ account }: { account: AccountWithBalance }) {
  if (!isOwedType(account.type)) {
    return (
      <p className="shrink-0 text-right font-medium tabular-nums">
        <Amount value={account.balance} />
      </p>
    );
  }
  const owed = cardOutstanding(account.balance);
  if (owed === 0) {
    return (
      <p className="shrink-0 text-sm text-muted">{account.type === "loan" ? "Paid off" : "Nothing due"}</p>
    );
  }
  return (
    <p className="flex shrink-0 flex-col items-end tabular-nums">
      <span className="font-medium">{formatINR(Math.abs(owed))}</span>
      <span className="text-xs text-muted">
        {owed < 0 ? "in credit" : account.type === "loan" ? "owed" : "due"}
      </span>
    </p>
  );
}
