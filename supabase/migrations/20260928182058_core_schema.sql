-- Core schema: accounts, categories, transactions, tags, recurring commitments,
-- budget rules and settings.
--
-- Conventions (docs/tech-decisions.md):
--   * Money is whole paise in bigint (TD-8). Moments are timestamptz (TD-9).
--   * Every row has a user_id, and RLS limits each user to their own rows (TD-2).
--   * References between tables include user_id, so a row can never point at
--     another user's row, even though foreign key checks bypass RLS.

create schema if not exists private;

-- Accounts (FR-1) ------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  type text not null check (type in ('bank', 'credit_card', 'wallet', 'savings')),
  -- Balance on opening_date. Negative when money is owed, as on a credit card.
  opening_balance bigint not null default 0,
  opening_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  statement_day smallint check (statement_day between 1 and 31),
  due_day smallint check (due_day between 1 and 31),
  -- The account INS-03 (emergency fund coverage) reads.
  is_emergency_fund boolean not null default false,
  sort_order integer not null default 0,
  -- Archived accounts leave the entry screens but stay in reports.
  -- Accounts with history can't be deleted, only archived.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (type = 'credit_card' or (statement_day is null and due_day is null)),
  check (type = 'savings' or not is_emergency_fund)
);
create unique index accounts_user_name_key on public.accounts (user_id, lower(name));

-- Categories and subcategories (FR-4) ------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order integer not null default 0,
  -- Hidden categories leave the entry screens but stay in reports.
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, id, kind)
);
create unique index categories_user_kind_name_key
  on public.categories (user_id, kind, lower(name));

create table public.subcategories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  -- Always the same as the category's kind (enforced by the foreign key below).
  kind text not null check (kind in ('expense', 'income')),
  name text not null check (length(trim(name)) between 1 and 60),
  -- Lost Track: it can be renamed but not deleted (FR-4).
  is_system boolean not null default false,
  sort_order integer not null default 0,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, id, kind),
  foreign key (user_id, category_id, kind) references public.categories (user_id, id, kind)
);
create unique index subcategories_category_name_key
  on public.subcategories (category_id, lower(name));

create function private.protect_system_subcategory()
returns trigger
language plpgsql
security definer -- reads auth.users, which signed-in users can't
set search_path = ''
as $$
begin
  -- Deleting the whole user (a cascade from auth.users) is still allowed.
  if old.is_system and exists (select 1 from auth.users where id = old.user_id) then
    raise exception 'The system subcategory "%" cannot be deleted', old.name;
  end if;
  return old;
end;
$$;

create trigger protect_system_subcategory
  before delete on public.subcategories
  for each row execute function private.protect_system_subcategory();

-- Budget rules (FR-7) ----------------------------------------------------------

create table public.budget_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  -- 'income': the budget month's actual income. 'fixed': fixed_base every month.
  base text not null default 'income' check (base in ('income', 'fixed')),
  fixed_base bigint check (fixed_base > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (base = 'income' or fixed_base is not null)
);
create unique index budget_rules_one_active_key on public.budget_rules (user_id) where is_active;

create table public.budget_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 40),
  -- Share of the base in basis points (5000 = 50%). A rule's buckets add up to
  -- 10000; the app checks that, since a rule is edited one bucket at a time.
  share_bp integer not null check (share_bp between 1 and 10000),
  -- Transfers into savings accounts count toward this bucket (FR-3, FR-7).
  holds_savings boolean not null default false,
  sort_order integer not null default 0,
  unique (user_id, id),
  unique (user_id, rule_id, id),
  foreign key (user_id, rule_id) references public.budget_rules (user_id, id) on delete cascade
);
create unique index budget_buckets_rule_name_key on public.budget_buckets (rule_id, lower(name));
create unique index budget_buckets_one_savings_key on public.budget_buckets (rule_id) where holds_savings;

-- Which bucket each expense subcategory falls in, per rule. Changing it changes
-- the figures for every month (FR-4 AC3).
create table public.bucket_assignments (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id uuid not null,
  subcategory_id uuid not null,
  bucket_id uuid not null,
  primary key (rule_id, subcategory_id),
  foreign key (user_id, rule_id, bucket_id)
    references public.budget_buckets (user_id, rule_id, id) on delete cascade,
  foreign key (user_id, subcategory_id)
    references public.subcategories (user_id, id) on delete cascade
);
create index bucket_assignments_subcategory_idx on public.bucket_assignments (subcategory_id);
create index bucket_assignments_bucket_idx on public.bucket_assignments (bucket_id);

-- Recurring commitments (FR-6) -------------------------------------------------

create table public.recurring_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null check (kind in ('expense', 'transfer')),
  -- Expected amount. For a variable bill (electricity) it's an estimate, and the
  -- real figure is entered when the payment is confirmed.
  amount bigint not null check (amount > 0),
  is_variable boolean not null default false,
  account_id uuid not null,
  to_account_id uuid,
  subcategory_id uuid,
  category_kind text generated always as (
    case when kind = 'expense' then 'expense' end
  ) stored,
  -- Due every `every` `unit`s, counting from first_due_on. A monthly due day of
  -- 29-31 falls on the last day of shorter months.
  unit text not null check (unit in ('week', 'month', 'year')),
  every smallint not null default 1 check (every between 1 and 52),
  first_due_on date not null,
  ends_on date,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, to_account_id) references public.accounts (user_id, id),
  foreign key (user_id, subcategory_id, category_kind)
    references public.subcategories (user_id, id, kind),
  check ((kind = 'transfer') = (to_account_id is not null)),
  check ((kind = 'expense') = (subcategory_id is not null)),
  check (to_account_id <> account_id),
  check (ends_on is null or ends_on >= first_due_on)
);
create index recurring_commitments_account_idx on public.recurring_commitments (account_id);
create index recurring_commitments_to_account_idx on public.recurring_commitments (to_account_id);
create index recurring_commitments_subcategory_idx on public.recurring_commitments (subcategory_id);

-- Tags (FR-5) ------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  -- Optional date range, used only to suggest tagging (never automatic).
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create unique index tags_user_name_key on public.tags (user_id, lower(name));

-- Imports ----------------------------------------------------------------------

-- One run of the history import (TD-12). Deleting a batch deletes its
-- transactions, which undoes the import.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name text not null,
  row_count integer not null default 0,
  imported_at timestamptz not null default now(),
  unique (user_id, id)
);

-- Transactions (FR-2, FR-3, BR-1 to BR-14) ------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- expense:    money out of account_id, counted as spending (BR-1)
  -- income:     money into account_id (BR-2)
  -- refund:     money into account_id that reduces its subcategory's spending (BR-6)
  -- transfer:   account_id -> to_account_id, never spending or income (BR-3)
  -- adjustment: corrects account_id's balance, excluded from every insight (BR-13)
  kind text not null check (kind in ('expense', 'income', 'refund', 'transfer', 'adjustment')),
  occurred_at timestamptz not null,
  -- Paise. Always positive, except an adjustment, which is signed.
  amount bigint not null,
  account_id uuid not null,
  to_account_id uuid,
  subcategory_id uuid,
  -- The kind of subcategory this transaction needs, so the foreign key below
  -- rejects an income subcategory on an expense and vice versa.
  category_kind text generated always as (
    case kind
      when 'expense' then 'expense'
      when 'refund' then 'expense'
      when 'income' then 'income'
    end
  ) stored,
  note text,
  description text,
  -- Planned (future-dated) entries show in Upcoming and reserved money, but not
  -- in balances or actual spending until confirmed (BR-7).
  is_planned boolean not null default false,
  -- Puts this one transaction in a different budget bucket (FR-7).
  bucket_override_id uuid,
  -- The commitment this payment was for (FR-6, INS-09).
  recurring_id uuid,
  import_batch_id uuid,
  -- For imported rows: the old app's names for account, category and subcategory,
  -- and a key that lets a re-import skip rows already imported (TD-12).
  import_source jsonb,
  import_key text,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, import_key),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, to_account_id) references public.accounts (user_id, id),
  foreign key (user_id, subcategory_id, category_kind)
    references public.subcategories (user_id, id, kind),
  foreign key (user_id, bucket_override_id)
    references public.budget_buckets (user_id, id) on delete set null (bucket_override_id),
  foreign key (user_id, recurring_id)
    references public.recurring_commitments (user_id, id) on delete set null (recurring_id),
  foreign key (user_id, import_batch_id)
    references public.import_batches (user_id, id) on delete cascade,
  check (case when kind = 'adjustment' then amount <> 0 else amount > 0 end),
  check ((kind = 'transfer') = (to_account_id is not null)),
  check (to_account_id <> account_id),
  check ((category_kind is not null) = (subcategory_id is not null)),
  check (import_key is null or import_batch_id is not null)
);
create index transactions_user_occurred_idx on public.transactions (user_id, occurred_at desc);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_to_account_idx on public.transactions (to_account_id);
create index transactions_subcategory_idx on public.transactions (subcategory_id);
create index transactions_bucket_override_idx on public.transactions (bucket_override_id);
create index transactions_recurring_idx on public.transactions (recurring_id);
create index transactions_import_batch_idx on public.transactions (import_batch_id);

create table public.transaction_tags (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  tag_id uuid not null,
  primary key (transaction_id, tag_id),
  foreign key (user_id, transaction_id)
    references public.transactions (user_id, id) on delete cascade,
  foreign key (user_id, tag_id) references public.tags (user_id, id) on delete cascade
);
create index transaction_tags_tag_idx on public.transaction_tags (tag_id);

-- Settings (one row per user) --------------------------------------------------

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Day the budget month starts (FR-12). At most 28, so every month has it.
  budget_month_start_day smallint not null default 1
    check (budget_month_start_day between 1 and 28),
  -- INS-06 small-spend threshold in paise (default ₹200).
  small_spend_threshold bigint not null default 20000 check (small_spend_threshold > 0),
  created_at timestamptz not null default now()
);

-- Access: signed-in users, own rows only (TD-2) --------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'subcategories', 'budget_rules', 'budget_buckets',
    'bucket_assignments', 'recurring_commitments', 'tags', 'import_batches',
    'transactions', 'transaction_tags', 'settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format(
      'create policy "Users manage their own rows" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

-- Default data for each user (BRD §10) ----------------------------------------

create function private.create_default_data(owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule uuid;
  needs uuid;
  wants uuid;
  cat uuid;
  sub uuid;
  r record;
begin
  insert into public.settings (user_id) values (owner) on conflict do nothing;

  insert into public.budget_rules (user_id, name, is_active)
    values (owner, '50/30/20', true) returning id into rule;
  insert into public.budget_buckets (user_id, rule_id, name, share_bp, sort_order)
    values (owner, rule, 'Needs', 5000, 1) returning id into needs;
  insert into public.budget_buckets (user_id, rule_id, name, share_bp, sort_order)
    values (owner, rule, 'Wants', 3000, 2) returning id into wants;
  insert into public.budget_buckets (user_id, rule_id, name, share_bp, holds_savings, sort_order)
    values (owner, rule, 'Savings', 2000, true, 3);

  for r in
    select * from (values
      ('expense', 1, 'Home',            1, 'Rent',                          'Needs', false),
      ('expense', 1, 'Home',            2, 'Furniture & appliance rental',  'Needs', false),
      ('expense', 1, 'Home',            3, 'House help',                    'Needs', false),
      ('expense', 1, 'Home',            4, 'Electricity',                   'Needs', false),
      ('expense', 1, 'Home',            5, 'Internet',                      'Needs', false),
      ('expense', 1, 'Home',            6, 'Cooking gas',                   'Needs', false),
      ('expense', 1, 'Home',            7, 'Maintenance & repairs',         'Needs', false),
      ('expense', 2, 'Food',            1, 'Groceries',                     'Needs', false),
      ('expense', 2, 'Food',            2, 'Healthy food',                  'Needs', false),
      ('expense', 2, 'Food',            3, 'Eating out',                    'Wants', false),
      ('expense', 2, 'Food',            4, 'Junk & treats',                 'Wants', false),
      ('expense', 3, 'Transport',       1, 'Rickshaw',                      'Needs', false),
      ('expense', 3, 'Transport',       2, 'Bus',                           'Needs', false),
      ('expense', 3, 'Transport',       3, 'Train & metro',                 'Needs', false),
      ('expense', 3, 'Transport',       4, 'Cab & bike taxi',               'Wants', false),
      ('expense', 3, 'Transport',       5, 'Fuel',                          'Needs', false),
      ('expense', 4, 'Health',          1, 'Medical',                       'Needs', false),
      ('expense', 4, 'Health',          2, 'Insurance',                     'Needs', false),
      ('expense', 4, 'Health',          3, 'Gym & training',                'Wants', false),
      ('expense', 4, 'Health',          4, 'Supplements & protein',         'Wants', false),
      ('expense', 5, 'Personal',        1, 'Clothing & shoes',              'Wants', false),
      ('expense', 5, 'Personal',        2, 'Laundry & ironing',             'Needs', false),
      ('expense', 5, 'Personal',        3, 'Grooming & skincare',           'Wants', false),
      ('expense', 5, 'Personal',        4, 'Toiletries & home supplies',    'Needs', false),
      ('expense', 5, 'Personal',        5, 'Gadgets & personal items',      'Wants', false),
      ('expense', 5, 'Personal',        6, 'Documents & admin',             'Needs', false),
      ('expense', 5, 'Personal',        7, 'Lost Track',                    'Wants', true),
      ('expense', 6, 'Bills',           1, 'Phone',                         'Needs', false),
      ('expense', 6, 'Bills',           2, 'Subscriptions',                 'Wants', false),
      ('expense', 6, 'Bills',           3, 'Bank fees & taxes',             'Needs', false),
      ('expense', 7, 'Fun & Travel',    1, 'Trips',                         'Wants', false),
      ('expense', 7, 'Fun & Travel',    2, 'Movies & events',               'Wants', false),
      ('expense', 7, 'Fun & Travel',    3, 'Games & sports',                'Wants', false),
      ('expense', 8, 'Family & Giving', 1, 'Family',                        'Needs', false),
      ('expense', 8, 'Family & Giving', 2, 'Friends & others',              'Wants', false),
      ('expense', 8, 'Family & Giving', 3, 'Donations',                     'Wants', false),
      ('income',  1, 'Salary',          1, 'Salary',                        null,    false),
      ('income',  2, 'Side income',     1, 'Freelance',                     null,    false),
      ('income',  2, 'Side income',     2, 'Prizes',                        null,    false),
      ('income',  2, 'Side income',     3, 'Selling items',                 null,    false),
      ('income',  3, 'Returns',         1, 'Interest',                      null,    false),
      ('income',  3, 'Returns',         2, 'Cashback',                      null,    false),
      ('income',  3, 'Returns',         3, 'Bond interest',                 null,    false),
      ('income',  4, 'Other',           1, 'Bonus',                         null,    false),
      ('income',  4, 'Other',           2, 'Other',                         null,    false)
    ) as t(kind, cat_sort, cat_name, sub_sort, sub_name, bucket, is_system)
  loop
    select id into cat from public.categories
      where user_id = owner and kind = r.kind and name = r.cat_name;
    if cat is null then
      insert into public.categories (user_id, kind, name, sort_order)
        values (owner, r.kind, r.cat_name, r.cat_sort) returning id into cat;
    end if;

    insert into public.subcategories (user_id, category_id, kind, name, is_system, sort_order)
      values (owner, cat, r.kind, r.sub_name, r.is_system, r.sub_sort) returning id into sub;

    if r.bucket is not null then
      insert into public.bucket_assignments (user_id, rule_id, subcategory_id, bucket_id)
        values (owner, rule, sub, case r.bucket when 'Needs' then needs else wants end);
    end if;
  end loop;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_default_data(new.id);
  return new;
end;
$$;

revoke all on function private.create_default_data(uuid) from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.protect_system_subcategory() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Accounts that already exist (the owner's) get the defaults now.
select private.create_default_data(u.id)
from auth.users u
where not exists (select 1 from public.categories c where c.user_id = u.id);
