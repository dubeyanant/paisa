import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AccountType } from "@/lib/finance/types";

export type AccountWithBalance = {
  id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  opening_date: string;
  statement_day: number | null;
  due_day: number | null;
  is_emergency_fund: boolean;
  // Money set aside for bills and planned spending (TD-18).
  is_blocked: boolean;
  archived_at: string | null;
  // Opening balance plus every confirmed transaction, from the
  // account_balances view (same rules as accountBalances()).
  balance: number;
};

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const COLUMNS =
  "id, name, type, opening_balance, opening_date, statement_day, due_day, is_emergency_fund, is_blocked, archived_at";

// Every account, archived ones included, with its current balance.
export async function listAccounts(): Promise<AccountWithBalance[]> {
  await requireUser();
  const supabase = await createClient();
  const [accounts, balances] = await Promise.all([
    supabase.from("accounts").select(COLUMNS).order("sort_order").order("name"),
    supabase.from("account_balances").select("account_id, balance"),
  ]);
  if (accounts.error) throw accounts.error;
  if (balances.error) throw balances.error;

  const balanceOf = new Map(
    balances.data.map((b) => [b.account_id as string, Number(b.balance)]),
  );
  return (accounts.data as Omit<AccountWithBalance, "balance">[]).map((a) => ({
    ...a,
    opening_balance: Number(a.opening_balance),
    balance: balanceOf.get(a.id) ?? Number(a.opening_balance),
  }));
}

// One account, and whether it has any entries (then it can't be deleted).
export async function getAccount(id: string) {
  await requireUser();
  // Also keeps the id safe to put in the filter below.
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [account, balance, entries] = await Promise.all([
    supabase.from("accounts").select(COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("account_balances").select("balance").eq("account_id", id).maybeSingle(),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .or(`account_id.eq.${id},to_account_id.eq.${id}`),
  ]);
  if (account.error) throw account.error;
  if (!account.data) notFound();
  if (balance.error) throw balance.error;
  if (entries.error) throw entries.error;

  const row = account.data as Omit<AccountWithBalance, "balance">;
  return {
    account: {
      ...row,
      opening_balance: Number(row.opening_balance),
      balance: Number(balance.data?.balance ?? row.opening_balance),
    } satisfies AccountWithBalance,
    entryCount: entries.count ?? 0,
  };
}
