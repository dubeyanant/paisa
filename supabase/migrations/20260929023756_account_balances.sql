-- Each account's current balance: its opening balance plus every confirmed
-- transaction. The rules are the same as accountBalances() in
-- src/lib/finance/balances.ts, and supabase/tests/migrations.test.ts checks that
-- both agree. Summing in the database keeps the Accounts screen fast with years
-- of history (NFR-3, NFR-8).
--
-- security_invoker: the view reads with the caller's rights, so RLS limits it to
-- the signed-in user's accounts (TD-2).

create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.opening_balance + coalesce(sum(m.delta), 0)::bigint as balance
from public.accounts a
left join (
  -- Money out of, or into, account_id. An adjustment is already signed.
  select t.account_id,
         case when t.kind in ('expense', 'transfer') then -t.amount else t.amount end as delta
    from public.transactions t
   where not t.is_planned
  union all
  -- The receiving side of a transfer.
  select t.to_account_id, t.amount
    from public.transactions t
   where not t.is_planned and t.kind = 'transfer'
) m on m.account_id = a.id
group by a.id;

revoke all on table public.account_balances from anon, authenticated;
grant select on table public.account_balances to authenticated;
