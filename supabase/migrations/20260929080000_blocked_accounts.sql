-- Blocked accounts: money already set aside for bills and planned spending,
-- like a "Blocked" wallet or sinking funds. It can't be spent on anything
-- else, so it doesn't count as available to spend.
--
-- Only adds a column, so the deployed app keeps working (TD-3).

alter table public.accounts
  add column is_blocked boolean not null default false,
  -- Only money you can spend from can be blocked.
  add constraint accounts_blocked_type_check check (type in ('bank', 'wallet') or not is_blocked);
