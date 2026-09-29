-- Skipping a due date of a recurring commitment (FR-6, TD-16): a month the gym
-- was closed, or a bill that didn't come. A skipped due date drops out of the
-- commitment's schedule, so it's neither pending nor reserved, and linked
-- payments cover the remaining due dates in order.
--
-- Only adds, so the deployed app keeps working (TD-3).

create table public.recurring_skips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recurring_id uuid not null,
  due_on date not null,
  created_at timestamptz not null default now(),
  primary key (recurring_id, due_on),
  foreign key (user_id, recurring_id)
    references public.recurring_commitments (user_id, id) on delete cascade
);

-- Access: signed-in users, own rows only (TD-2).
alter table public.recurring_skips enable row level security;
revoke all on table public.recurring_skips from anon, authenticated;
grant select, insert, update, delete on table public.recurring_skips to authenticated;
create policy "Users manage their own rows" on public.recurring_skips for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
