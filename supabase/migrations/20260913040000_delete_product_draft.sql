-- Deleting a product draft that never left Fanwise.
--
-- A creator can permanently delete a canonical product only while nothing
-- outside Fanwise knows about it: no channel was ever asked to create it, no
-- channel holds a reference to it, no activity was recorded about it, and no
-- public page was ever made for it. Retiring a product that *has* been seen
-- somewhere is a different act, with obligations to buyers and channels, and
-- it is not this function. Archive, restore and marketplace removal are future
-- work; see docs/data-model.md.
--
-- Two functions and one revocation.
--
--   1. product_draft_deletion_blocker(uuid) is the one definition of "may this
--      be deleted". It returns null when the product may go, 'not_found' when
--      the caller does not own it (or it does not exist, which reads the same),
--      and otherwise a stable blocker code. The product page calls it to decide
--      whether to offer Delete draft; delete_product_draft calls it again,
--      after locking, to decide whether to actually delete. One definition, so
--      the button and the database cannot disagree.
--
--   2. delete_product_draft(uuid) is the only path by which a signed-in user
--      deletes a product. It locks, re-checks, clears the product out of the
--      public-profile builder's draft, collects every stored object's path,
--      deletes the product and lets its internal dependents cascade, and
--      returns the paths for the server to remove from storage after commit.
--
--   3. Direct DELETE on products is revoked from authenticated, and its RLS
--      policy dropped. Until now any workspace member could delete any product
--      through PostgREST, which would bypass every rule below. RLS still
--      governs select, insert and update exactly as before.
--
-- Why security definer. With DELETE revoked, a security invoker function could
-- not delete the row it has just decided may go. So this one runs as its owner,
-- and makes up for it: it requires auth.uid(), checks is_workspace_owner()
-- itself before it reads or locks anything a caller could not already see,
-- pins search_path to '', schema-qualifies every relation, and is executable by
-- authenticated only. A product in another workspace, a product the caller is
-- a member but not the owner of, and a product that does not exist all return
-- the same 'not_found', so the function cannot be used to learn that an id
-- exists.
--
-- What blocks, and why each one:
--
--   public_page                 Any public_product_pages row, whatever its
--                               status. A draft page may have been published
--                               and unpublished; its slug may be cached, linked
--                               or indexed. Conservative on purpose.
--   listing_external_reference  A listing with external_listing_id or
--                               external_url. A channel holds this product.
--   listing_live                A listing publishing or published, or a
--                               completed manual step: a person told Fanwise
--                               they did the channel's half by hand.
--   publication_history         Any publication_jobs row, any outcome. A job
--                               is an external write that was at least
--                               attempted, and a failed one may still have
--                               landed.
--   activity_history            Any workspace_events row about the product or
--                               its listings. The log is append-only, and its
--                               immutability trigger refuses even a cascaded
--                               delete; that trigger is not touched here.
--   import_in_progress          The import is pending, retrieving or
--                               analyzing, or one of its sources is uploading,
--                               transcribing, pending or reading.
--   generation_in_progress      An AI generation pending or running.
--   upload_in_progress          A product asset still pending: a signed upload
--                               URL is outstanding, or the finalize job has not
--                               measured the bytes. The creator can remove the
--                               unfinished file and try again.
--
-- What cascades, because none of it has left Fanwise: product assets and their
-- derivatives, draft channel listings, their snapshots (the snapshot trigger
-- already permits a delete whose listing is gone), their manual steps with no
-- step completed, finished AI generations, and the import with its sources and
-- evidence.
--
-- Serialization. Every row whose state could turn a draft into a blocked one
-- is locked FOR UPDATE before the check runs:
--
--   - the product: a new listing, asset, generation, import, event or public
--     page references it by foreign key, which takes a KEY SHARE lock on it.
--     One that committed first is seen by the check; one that arrives after
--     waits, then fails its foreign key once the product is gone.
--   - its listings: a new publication job or manual step references the
--     listing, and a status or external id change updates it. Same argument.
--   - its manual steps, import and import sources: their status changes are
--     updates to those rows, which do not touch the product.
--
-- So publication and deletion cannot both succeed: whichever commits first,
-- the other either sees it or fails its foreign key. Two deletions in a row
-- are one deletion and one 'not_found'.
--
-- Lock order: profile drafts, product, listings, manual steps, import,
-- sources. The profile drafts come first because publish_all_profile_products
-- locks a draft and then inserts a public page (a KEY SHARE on the product);
-- taking the product first here would let the two deadlock.
--
-- Storage. SQL cannot remove storage objects, and must not try before the
-- commit: an object removed for a transaction that then refused would leave a
-- visible asset row pointing at nothing. So the paths are collected before the
-- delete (a cascade reports nothing back), deduplicated, returned, and removed
-- by the server afterwards. If that removal fails the cost is private bytes
-- nothing points at. Both lists are in the product-assets bucket; they are
-- returned separately because they are different kinds of object.
--
-- Rollback: drop both functions; grant delete on public.products to
-- authenticated; recreate the policy "products are deletable by workspace
-- members" using (public.is_workspace_member(workspace_id)). No data changes.

-- ---------------------------------------------------------------------------
-- product_draft_deletion_blocker
-- ---------------------------------------------------------------------------

create or replace function public.product_draft_deletion_blocker(p_product_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select p.workspace_id into v_workspace_id
  from public.products p
  where p.id = p_product_id;

  if v_workspace_id is null or not public.is_workspace_owner(v_workspace_id) then
    return 'not_found';
  end if;

  -- Permanent blockers first: telling a creator to wait for an import is
  -- wrong when waiting would not make the product deletable.
  if exists (
    select 1
    from public.public_product_pages pp
    where pp.product_id = p_product_id
      and pp.workspace_id = v_workspace_id
  ) then
    return 'public_page';
  end if;

  if exists (
    select 1
    from public.channel_listings l
    where l.product_id = p_product_id
      and l.workspace_id = v_workspace_id
      and (l.external_listing_id is not null or l.external_url is not null)
  ) then
    return 'listing_external_reference';
  end if;

  if exists (
    select 1
    from public.channel_listings l
    where l.product_id = p_product_id
      and l.workspace_id = v_workspace_id
      and l.status in ('publishing', 'published')
  ) or exists (
    select 1
    from public.listing_manual_steps s
    join public.channel_listings l on l.id = s.channel_listing_id
    where l.product_id = p_product_id
      and l.workspace_id = v_workspace_id
      and s.completed_at is not null
  ) then
    return 'listing_live';
  end if;

  if exists (
    select 1
    from public.publication_jobs j
    join public.channel_listings l on l.id = j.channel_listing_id
    where l.product_id = p_product_id
      and l.workspace_id = v_workspace_id
  ) then
    return 'publication_history';
  end if;

  if exists (
    select 1
    from public.workspace_events e
    where e.workspace_id = v_workspace_id
      and (
        e.product_id = p_product_id
        or e.channel_listing_id in (
          select l.id
          from public.channel_listings l
          where l.product_id = p_product_id
        )
      )
  ) then
    return 'activity_history';
  end if;

  if exists (
    select 1
    from public.product_imports i
    where i.product_id = p_product_id
      and i.workspace_id = v_workspace_id
      and i.status in ('pending', 'retrieving', 'analyzing')
  ) or exists (
    select 1
    from public.product_import_sources s
    join public.product_imports i on i.id = s.import_id
    where i.product_id = p_product_id
      and s.workspace_id = v_workspace_id
      and s.status in ('uploading', 'transcribing', 'pending', 'reading')
  ) then
    return 'import_in_progress';
  end if;

  if exists (
    select 1
    from public.ai_generations g
    where g.product_id = p_product_id
      and g.workspace_id = v_workspace_id
      and g.status in ('pending', 'running')
  ) then
    return 'generation_in_progress';
  end if;

  if exists (
    select 1
    from public.product_assets a
    where a.product_id = p_product_id
      and a.workspace_id = v_workspace_id
      and a.asset_state = 'pending'
  ) then
    return 'upload_in_progress';
  end if;

  return null;
end;
$$;

comment on function public.product_draft_deletion_blocker(uuid) is
  'Why a product may not be permanently deleted: null when it may, not_found when the caller does not own it, otherwise a stable blocker code. Security invoker. The single definition read by the product page and by delete_product_draft().';

revoke all on function public.product_draft_deletion_blocker(uuid) from public, anon;
grant execute on function public.product_draft_deletion_blocker(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_product_draft
-- ---------------------------------------------------------------------------

create or replace function public.delete_product_draft(p_product_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_blocker text;
  v_asset_paths text[];
  v_import_source_paths text[];
  v_not_found constant jsonb := jsonb_build_object(
    'outcome', 'not_found',
    'blocker', null,
    'asset_paths', '[]'::jsonb,
    'import_source_paths', '[]'::jsonb
  );
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Ownership before any lock. Locking first would let a caller who owns
  -- nothing hold, or wait on, a row in another workspace, and learn from the
  -- wait that it exists.
  select p.workspace_id into v_workspace_id
  from public.products p
  where p.id = p_product_id;

  if v_workspace_id is null or not public.is_workspace_owner(v_workspace_id) then
    return v_not_found;
  end if;

  perform 1
  from public.public_profile_drafts d
  where d.workspace_id = v_workspace_id
  for update;

  perform 1
  from public.products p
  where p.id = p_product_id
    and p.workspace_id = v_workspace_id
  for update;

  -- Deleted by a concurrent call while this one waited for the lock.
  if not found then
    return v_not_found;
  end if;

  perform 1
  from public.channel_listings l
  where l.product_id = p_product_id
    and l.workspace_id = v_workspace_id
  order by l.id
  for update;

  perform 1
  from public.listing_manual_steps s
  join public.channel_listings l on l.id = s.channel_listing_id
  where l.product_id = p_product_id
    and l.workspace_id = v_workspace_id
  order by s.id
  for update of s;

  perform 1
  from public.product_imports i
  where i.product_id = p_product_id
    and i.workspace_id = v_workspace_id
  for update;

  perform 1
  from public.product_import_sources s
  join public.product_imports i on i.id = s.import_id
  where i.product_id = p_product_id
    and s.workspace_id = v_workspace_id
  order by s.id
  for update of s;

  -- Every condition again, now that nothing it reads can change under it.
  v_blocker := public.product_draft_deletion_blocker(p_product_id);

  if v_blocker = 'not_found' then
    return v_not_found;
  end if;

  if v_blocker is not null then
    return jsonb_build_object(
      'outcome', 'blocked',
      'blocker', v_blocker,
      'asset_paths', '[]'::jsonb,
      'import_source_paths', '[]'::jsonb
    );
  end if;

  -- The paths before the delete: the cascade reports nothing back.
  -- Derivatives carry the same product_id, so they are included.
  select coalesce(array_agg(distinct a.storage_path order by a.storage_path), array[]::text[])
  into v_asset_paths
  from public.product_assets a
  where a.product_id = p_product_id
    and a.workspace_id = v_workspace_id;

  -- The legacy single-source column and the per-source rows usually name the
  -- same object, because the sources were backfilled from it.
  select coalesce(array_agg(distinct paths.object_path order by paths.object_path), array[]::text[])
  into v_import_source_paths
  from (
    select i.source_path as object_path
    from public.product_imports i
    where i.product_id = p_product_id
      and i.workspace_id = v_workspace_id
      and i.source_path is not null
    union
    select s.storage_path as object_path
    from public.product_import_sources s
    join public.product_imports i on i.id = s.import_id
    where i.product_id = p_product_id
      and s.workspace_id = v_workspace_id
      and s.storage_path is not null
  ) as paths;

  -- The builder's arrangement names products in jsonb, which no foreign key
  -- can cascade. Rewriting the array fires check_profile_draft_products(),
  -- which refuses any id that is not a product of this workspace, so ids of
  -- products already deleted before this function existed are dropped here
  -- too; keeping them would make this update, and so the deletion, fail. The
  -- revision moves, so a builder tab holding the old arrangement gets a
  -- conflict on its next save rather than writing the product back.
  update public.public_profile_drafts d
  set products = coalesce(
        (
          select jsonb_agg(entries.entry order by entries.ord)
          from jsonb_array_elements(d.products) with ordinality as entries(entry, ord)
          where public.uuid_or_null(entries.entry ->> 'productId') is distinct from p_product_id
            and exists (
              select 1
              from public.products p
              where p.id = public.uuid_or_null(entries.entry ->> 'productId')
                and p.workspace_id = d.workspace_id
            )
        ),
        '[]'::jsonb
      ),
      revision = d.revision + 1
  where d.workspace_id = v_workspace_id
    and exists (
      select 1
      from jsonb_array_elements(d.products) as named(entry)
      where public.uuid_or_null(named.entry ->> 'productId') = p_product_id
    );

  delete from public.products p
  where p.id = p_product_id
    and p.workspace_id = v_workspace_id;

  return jsonb_build_object(
    'outcome', 'deleted',
    'blocker', null,
    'asset_paths', to_jsonb(v_asset_paths),
    'import_source_paths', to_jsonb(v_import_source_paths)
  );
end;
$$;

comment on function public.delete_product_draft(uuid) is
  'The only application path for deleting a product. Owner only; locks, re-checks product_draft_deletion_blocker(), clears the product from profile drafts, deletes, and returns {outcome, blocker, asset_paths, import_source_paths} for storage cleanup after commit. Security definer because authenticated holds no DELETE on products.';

revoke all on function public.delete_product_draft(uuid) from public, anon;
grant execute on function public.delete_product_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- No direct deletion
-- ---------------------------------------------------------------------------

drop policy "products are deletable by workspace members" on public.products;

revoke delete on public.products from authenticated;
