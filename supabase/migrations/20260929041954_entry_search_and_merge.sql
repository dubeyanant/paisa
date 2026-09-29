-- Functions for roadmap step 6: searching entries, totals for a search, and
-- merging subcategories and categories (FR-4, FR-8.3).
--
-- They run with the caller's rights (security invoker, the default), so RLS
-- limits them to the signed-in user's rows (TD-2). Only adds, so the deployed
-- app keeps working (TD-3).

-- Searching entries (FR-8.3) ---------------------------------------------------

-- Every transaction that matches all the filters given. A filter left null
-- doesn't apply. PostgREST can order, page and embed the result like a table.
--   since, until:  occurred_at in [since, until)
--   account:       money out of or into this account
--   bucket:        in this budget bucket, by the rules of bucketActuals() in
--                  src/lib/finance/budget.ts: an expense or refund by its
--                  override if that's in the bucket's rule, otherwise by its
--                  subcategory's assignment; a transfer into or out of savings
--                  in the rule's savings bucket
--   min_amount, max_amount:  paise, compared with the size of the amount
--   search:        text in the note, the description or the subcategory's name
create function public.search_transactions(
  since timestamptz default null,
  until timestamptz default null,
  account uuid default null,
  category uuid default null,
  subcategory uuid default null,
  bucket uuid default null,
  tag uuid default null,
  kinds text[] default null,
  min_amount bigint default null,
  max_amount bigint default null,
  search text default null
)
returns setof public.transactions
language sql
stable
set search_path = ''
as $$
  select t.*
    from public.transactions t
    left join public.subcategories s on s.id = t.subcategory_id
   where (since is null or t.occurred_at >= since)
     and (until is null or t.occurred_at < until)
     and (account is null or t.account_id = account or t.to_account_id = account)
     and (category is null or s.category_id = category)
     and (subcategory is null or t.subcategory_id = subcategory)
     and (kinds is null or t.kind = any (kinds))
     and (min_amount is null or abs(t.amount) >= min_amount)
     and (max_amount is null or abs(t.amount) <= max_amount)
     and (tag is null or exists (
       select 1 from public.transaction_tags tt where tt.transaction_id = t.id and tt.tag_id = tag
     ))
     and (search is null or exists (
       -- The search text is matched literally: % and _ aren't wildcards.
       select 1
         from (select '%' || replace(replace(replace(search, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern) p
        where t.note ilike p.pattern or t.description ilike p.pattern or s.name ilike p.pattern
     ))
     and (bucket is null or exists (
       select 1
         from public.budget_buckets b
        where b.id = bucket
          and case
            when t.kind in ('expense', 'refund') then
              coalesce(
                (select o.id from public.budget_buckets o
                  where o.id = t.bucket_override_id and o.rule_id = b.rule_id),
                (select a.bucket_id from public.bucket_assignments a
                  where a.rule_id = b.rule_id and a.subcategory_id = t.subcategory_id)
              ) = b.id
            when t.kind = 'transfer' then
              b.holds_savings
              and (select f.type = 'savings' from public.accounts f where f.id = t.account_id)
                  <> (select d.type = 'savings' from public.accounts d where d.id = t.to_account_id)
            else false
          end
     ))
$$;

-- Totals for the same search, by the rules of periodTotals() in
-- src/lib/finance/totals.ts. Planned entries are counted but not summed (BR-7).
create function public.transaction_totals(
  since timestamptz default null,
  until timestamptz default null,
  account uuid default null,
  category uuid default null,
  subcategory uuid default null,
  bucket uuid default null,
  tag uuid default null,
  kinds text[] default null,
  min_amount bigint default null,
  max_amount bigint default null,
  search text default null
)
returns table (
  entries bigint,
  planned bigint,
  income bigint,
  -- Expenses minus refunds (BR-6).
  spending bigint,
  -- Transfers into and out of savings accounts (BR-5).
  invested bigint,
  withdrawn bigint
)
language sql
stable
set search_path = ''
as $$
  select count(*),
         count(*) filter (where m.is_planned),
         coalesce(sum(m.amount) filter (where m.kind = 'income'), 0)::bigint,
         coalesce(sum(case m.kind when 'expense' then m.amount when 'refund' then -m.amount end), 0)::bigint,
         coalesce(sum(m.amount) filter (where m.kind = 'transfer' and m.to_savings and not m.from_savings), 0)::bigint,
         coalesce(sum(m.amount) filter (where m.kind = 'transfer' and m.from_savings and not m.to_savings), 0)::bigint
    from (
      select t.kind,
             -- Planned amounts drop out of every sum.
             case when t.is_planned then null else t.amount end as amount,
             t.is_planned,
             coalesce(f.type = 'savings', false) as from_savings,
             coalesce(d.type = 'savings', false) as to_savings
        from public.search_transactions(
               since, until, account, category, subcategory, bucket, tag, kinds,
               min_amount, max_amount, search
             ) t
        left join public.accounts f on f.id = t.account_id
        left join public.accounts d on d.id = t.to_account_id
    ) m
$$;

-- Merging (FR-4) ---------------------------------------------------------------

-- Moves every transaction and recurring commitment from one subcategory to
-- another of the same kind, then deletes the first. Its bucket assignments go
-- with it; transactions keep their own bucket overrides. All or nothing.
create function public.merge_subcategory(source uuid, target uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  from_kind text;
  from_system boolean;
  into_kind text;
begin
  select kind, is_system into from_kind, from_system from public.subcategories where id = source;
  select kind into into_kind from public.subcategories where id = target;
  if from_kind is null or into_kind is null then
    raise exception 'Subcategory not found' using errcode = 'P0002';
  end if;
  if source = target then
    raise exception 'A subcategory cannot be merged into itself' using errcode = '22023';
  end if;
  if from_kind <> into_kind then
    raise exception 'Only subcategories of the same kind can be merged' using errcode = '22023';
  end if;
  if from_system then
    raise exception 'The system subcategory cannot be merged away' using errcode = '22023';
  end if;

  update public.transactions set subcategory_id = target where subcategory_id = source;
  update public.recurring_commitments set subcategory_id = target where subcategory_id = source;
  delete from public.subcategories where id = source;
end;
$$;

-- Moves every subcategory of one category into another of the same kind, then
-- deletes the first. A subcategory whose name the target already has is merged
-- into that one. All or nothing.
create function public.merge_category(source uuid, target uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  from_kind text;
  into_kind text;
  sub record;
  same_name uuid;
begin
  select kind into from_kind from public.categories where id = source;
  select kind into into_kind from public.categories where id = target;
  if from_kind is null or into_kind is null then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if source = target then
    raise exception 'A category cannot be merged into itself' using errcode = '22023';
  end if;
  if from_kind <> into_kind then
    raise exception 'Only categories of the same kind can be merged' using errcode = '22023';
  end if;

  for sub in
    select id, name from public.subcategories where category_id = source order by sort_order, name
  loop
    select id into same_name
      from public.subcategories
     where category_id = target and lower(name) = lower(sub.name);
    if same_name is null then
      update public.subcategories
         set category_id = target,
             sort_order = (select coalesce(max(sort_order), 0) + 1
                             from public.subcategories where category_id = target)
       where id = sub.id;
    else
      perform public.merge_subcategory(sub.id, same_name);
    end if;
  end loop;

  delete from public.categories where id = source;
end;
$$;

-- Access: signed-in users only (TD-2) ------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.search_transactions(timestamptz, timestamptz, uuid, uuid, uuid, uuid, uuid, text[], bigint, bigint, text)',
    'public.transaction_totals(timestamptz, timestamptz, uuid, uuid, uuid, uuid, uuid, text[], bigint, bigint, text)',
    'public.merge_subcategory(uuid, uuid)',
    'public.merge_category(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
