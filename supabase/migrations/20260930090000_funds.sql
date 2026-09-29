-- Funds (TD-21): money kept for one purchase (a goal) or for a kind of
-- spending (an ongoing fund, such as Clothes or Trips). The money stays in the
-- bank. A fund's balance is only held back from available to spend, and
-- counts in its budget bucket when it goes in, not when it's spent.
--
-- Only adds, so the deployed app keeps working (TD-3). save_budget_rule() is
-- replaced with the same signature, so removed buckets hand on funds too.

create table public.funds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  -- goal:    saves `target` in even shares over the budget months up to the one
  --          containing ends_on, then pays for one purchase and closes.
  -- ongoing: saves monthly_amount every budget month, stopping at `cap` if set,
  --          and pays for any number of spends.
  kind text not null check (kind in ('goal', 'ongoing')),
  -- The budget bucket money going in counts toward (FR-7).
  bucket_id uuid,
  target bigint check (target > 0),
  monthly_amount bigint check (monthly_amount > 0),
  cap bigint check (cap > 0),
  -- A date in the budget month the schedule runs from. When the schedule
  -- changes, the months before are kept as fund_moves and this moves on, so
  -- past months never change.
  schedule_from date not null,
  -- A goal's last month: a date in it.
  ends_on date,
  -- Closed by hand: what's left goes back to being free to spend.
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, bucket_id)
    references public.budget_buckets (user_id, id) on delete set null (bucket_id),
  check ((kind = 'goal') = (target is not null)),
  check ((kind = 'goal') = (ends_on is not null)),
  check (kind = 'ongoing' or (monthly_amount is null and cap is null)),
  check (ends_on is null or ends_on >= schedule_from)
);
create index funds_bucket_idx on public.funds (bucket_id);

-- Money put into a fund (positive) or taken back out (negative) by hand, and
-- past months' scheduled amounts, kept when the schedule changed.
create table public.fund_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fund_id uuid not null,
  amount bigint not null check (amount <> 0),
  occurred_at timestamptz not null,
  is_monthly boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (user_id, fund_id) references public.funds (user_id, id) on delete cascade
);
create index fund_moves_fund_idx on public.fund_moves (fund_id);

-- The fund an expense is paid from, or a refund goes back to. A fund with
-- spends can't be deleted, only closed, so its history stays.
alter table public.transactions
  add column fund_id uuid,
  add foreign key (user_id, fund_id) references public.funds (user_id, id),
  add constraint transactions_fund_check
    check (fund_id is null or (kind in ('expense', 'refund') and not is_planned));
create index transactions_fund_idx on public.transactions (fund_id);

-- Access: signed-in users, own rows only (TD-2).
alter table public.funds enable row level security;
revoke all on table public.funds from anon, authenticated;
grant select, insert, update, delete on table public.funds to authenticated;
create policy "Users manage their own rows" on public.funds for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.fund_moves enable row level security;
revoke all on table public.fund_moves from anon, authenticated;
grant select, insert, update, delete on table public.fund_moves to authenticated;
create policy "Users manage their own rows" on public.fund_moves for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- As before (20260929090000_save_budget_rule.sql), and a removed bucket also
-- hands its funds to the bucket that takes its subcategories.
create or replace function public.save_budget_rule(
  rule uuid,
  new_name text,
  new_base text,
  new_fixed_base bigint,
  new_buckets jsonb,
  moves jsonb default '{}'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  owner uuid;
  item record;
  kept_id uuid;
  key_to_id jsonb := '{}';
  final_ids uuid[] := '{}';
  gone uuid;
  heir uuid;
begin
  select user_id into owner from public.budget_rules where id = rule for update;
  if owner is null then
    raise exception 'Budget rule not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(new_buckets) is distinct from 'array'
     or jsonb_array_length(new_buckets) not between 2 and 6 then
    raise exception 'A rule needs 2 to 6 buckets' using errcode = '22023';
  end if;
  if (select sum((x ->> 'share_bp')::integer) from jsonb_array_elements(new_buckets) x) <> 10000 then
    raise exception 'The shares must add up to 100%%' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(new_buckets) x where (x ->> 'holds_savings')::boolean) > 1 then
    raise exception 'Only one bucket can hold savings' using errcode = '22023';
  end if;
  -- Kept buckets must belong to this rule.
  if exists (
    select 1 from jsonb_array_elements(new_buckets) x
     where x ->> 'id' is not null
       and not exists (
         select 1 from public.budget_buckets bb where bb.id = (x ->> 'id')::uuid and bb.rule_id = rule
       )
  ) then
    raise exception 'Bucket not found in this rule' using errcode = 'P0002';
  end if;

  update public.budget_rules
     set name = new_name,
         base = new_base,
         fixed_base = case when new_base = 'fixed' then new_fixed_base end
   where id = rule;

  -- Clear what could clash while buckets swap names or the savings role.
  update public.budget_buckets bb
     set name = bb.id::text, holds_savings = false
   where bb.rule_id = rule
     and bb.id in (select (x ->> 'id')::uuid from jsonb_array_elements(new_buckets) x);

  for item in select x, n from jsonb_array_elements(new_buckets) with ordinality as t(x, n) loop
    if item.x ->> 'id' is not null then
      kept_id := (item.x ->> 'id')::uuid;
      update public.budget_buckets
         set name = item.x ->> 'name',
             share_bp = (item.x ->> 'share_bp')::integer,
             holds_savings = coalesce((item.x ->> 'holds_savings')::boolean, false),
             sort_order = item.n - 1
       where id = kept_id;
    else
      insert into public.budget_buckets (user_id, rule_id, name, share_bp, holds_savings, sort_order)
      values (
        owner, rule, item.x ->> 'name', (item.x ->> 'share_bp')::integer,
        coalesce((item.x ->> 'holds_savings')::boolean, false), item.n - 1
      )
      returning id into kept_id;
    end if;
    final_ids := final_ids || kept_id;
    key_to_id := key_to_id || jsonb_build_object(coalesce(item.x ->> 'key', kept_id::text), kept_id);
  end loop;

  -- Removed buckets hand on their subcategories, overrides and funds, then go.
  for gone in
    select bb.id from public.budget_buckets bb where bb.rule_id = rule and not (bb.id = any (final_ids))
  loop
    heir := (key_to_id ->> (coalesce(moves, '{}') ->> gone::text))::uuid;
    if heir is not null then
      update public.bucket_assignments set bucket_id = heir where bucket_id = gone;
      update public.transactions set bucket_override_id = heir where bucket_override_id = gone;
      update public.funds set bucket_id = heir where bucket_id = gone;
    end if;
    delete from public.budget_buckets where id = gone;
  end loop;
end;
$$;

-- Changing a fund in one go (TD-21): its fields, and the finished months of
-- the old schedule kept as fund_moves, so past months stay as they were even
-- if a save fails halfway. `kept` is a JSON array of
--   { "amount": bigint, "occurred_at": timestamptz }
-- Closed funds don't change. Runs with the caller's rights (TD-2).
create function public.update_fund(
  fund uuid,
  new_name text,
  new_bucket uuid,
  new_target bigint,
  new_monthly bigint,
  new_cap bigint,
  new_schedule_from date,
  new_ends_on date,
  kept jsonb default '[]'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.funds
     set name = new_name,
         bucket_id = new_bucket,
         target = new_target,
         monthly_amount = new_monthly,
         cap = new_cap,
         schedule_from = new_schedule_from,
         ends_on = new_ends_on
   where id = fund and closed_at is null;
  if not found then
    raise exception 'Fund not found or closed' using errcode = 'P0002';
  end if;

  insert into public.fund_moves (user_id, fund_id, amount, occurred_at, is_monthly)
  select f.user_id, f.id, (k ->> 'amount')::bigint, (k ->> 'occurred_at')::timestamptz, true
    from public.funds f, jsonb_array_elements(coalesce(kept, '[]')) k
   where f.id = fund;
end;
$$;

revoke all on function public.update_fund(uuid, text, uuid, bigint, bigint, bigint, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.update_fund(uuid, text, uuid, bigint, bigint, bigint, date, date, jsonb) to authenticated;
