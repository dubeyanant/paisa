-- Saving a budget rule in one go (FR-7): its name, base and buckets. Edited one
-- bucket at a time, a rule's shares wouldn't add up to 100% halfway through,
-- so this saves everything or nothing (TD-15).
--
-- It runs with the caller's rights, so RLS limits it to the signed-in user's
-- rules (TD-2). Only adds, so the deployed app keeps working (TD-3).

-- `new_buckets` is a JSON array, in the order to show them:
--   { "key": text, "id": uuid or null, "name": text, "share_bp": int, "holds_savings": bool }
-- A bucket with an id is kept (renamed, reshared); one without is added. The
-- rule's other buckets are removed. `key` names a bucket for `moves`; an
-- existing bucket's key is its id.
--
-- `moves` maps each removed bucket's id to the key of the bucket that takes
-- its subcategories and its entries' overrides. Without a move they're left
-- without a bucket.
create function public.save_budget_rule(
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
  target uuid;
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

  -- Removed buckets hand on their subcategories and overrides, then go.
  for gone in
    select bb.id from public.budget_buckets bb where bb.rule_id = rule and not (bb.id = any (final_ids))
  loop
    target := (key_to_id ->> (coalesce(moves, '{}') ->> gone::text))::uuid;
    if target is not null then
      update public.bucket_assignments set bucket_id = target where bucket_id = gone;
      update public.transactions set bucket_override_id = target where bucket_override_id = gone;
    end if;
    delete from public.budget_buckets where id = gone;
  end loop;
end;
$$;

revoke all on function public.save_budget_rule(uuid, text, text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_budget_rule(uuid, text, text, bigint, jsonb, jsonb) to authenticated;
