-- Ownership of the products a profile draft arranges.
--
-- `public_profile_drafts.products` is jsonb, so its product ids cannot be
-- foreign keys. The builder's server action checks every id against the
-- caller's own workspace before it writes, but a member can also write their
-- draft row directly through PostgREST, and an application check is only a
-- check on the path that goes through the application. This trigger is the
-- half that holds on every path: a draft may only name products that belong
-- to the draft's own workspace, each at most once, in a well-formed entry.
--
-- Security invoker, deliberately. The lookup runs as the writer, so RLS limits
-- it to workspaces the writer is a member of, and the explicit workspace_id
-- comparison then limits it to this draft's workspace. A definer function
-- would see every workspace's products and would have to reimplement that.
--
-- It fires only when `products` is written. A product deleted after it was
-- arranged does not make the draft's other columns unsavable; the builder
-- drops the missing id the next time the arrangement is saved, and
-- publication re-reads every id regardless.
--
-- Rollback: drop the trigger, then the function. No data changes.

create or replace function public.check_profile_draft_products()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_owned integer;
begin
  for v_entry in select value from jsonb_array_elements(new.products)
  loop
    if jsonb_typeof(v_entry) <> 'object'
      or jsonb_typeof(v_entry -> 'productId') <> 'string'
      or jsonb_typeof(v_entry -> 'visible') <> 'boolean'
    then
      raise exception 'malformed product entry in profile draft'
        using errcode = '23514';
    end if;

    v_id := public.uuid_or_null(v_entry ->> 'productId');
    if v_id is null then
      raise exception 'malformed product id in profile draft'
        using errcode = '23514';
    end if;
    if v_id = any (v_ids) then
      raise exception 'product % appears twice in profile draft', v_id
        using errcode = '23514';
    end if;
    v_ids := v_ids || v_id;
  end loop;

  if cardinality(v_ids) = 0 then
    return new;
  end if;

  select count(*) into v_owned
  from public.products p
  where p.id = any (v_ids)
    and p.workspace_id = new.workspace_id;

  if v_owned <> cardinality(v_ids) then
    raise exception 'profile draft names a product outside its workspace'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.check_profile_draft_products is
  'Refuses a profile draft whose products array is malformed, repeats a product, or names a product outside the draft''s workspace.';

create trigger check_profile_draft_products
  before insert or update of products on public.public_profile_drafts
  for each row execute function public.check_profile_draft_products();

-- Trigger-only. Postgres checks EXECUTE at CREATE TRIGGER, not when it fires.
revoke all on function public.check_profile_draft_products() from public, anon, authenticated;
