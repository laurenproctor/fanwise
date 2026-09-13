-- Removing a buyer file from an import, without ever leaving the product with none.
--
-- The import screen refuses to remove a product's last ready buyer file, which
-- is what makes "replace" safe: the creator uploads the new file first, and the
-- old one cannot go until the new one has been measured. That rule used to live
-- in the server action as two separate requests — read the files, then delete
-- one — with nothing holding them together. Two removals arriving together
-- (two tabs, a quick double action) against a product with exactly two ready
-- files could each read the other file as still there, both pass, and both
-- delete, leaving a product with nothing to deliver.
--
-- This function is the check and the delete in one transaction, serialized per
-- product. The first statement locks the product row; a second removal for the
-- same product waits on that lock, and when it runs it reads the files as the
-- first removal left them. So of two concurrent removals of the only two ready
-- files, exactly one succeeds and the other is refused.
--
-- Security invoker, deliberately. Every statement runs as the signed-in creator
-- and passes their own RLS: a product in another workspace is invisible, so it
-- locks nothing and is reported not found, exactly as a product that does not
-- exist would be. Locking with FOR UPDATE needs the update policy on products,
-- which a workspace member already holds.
--
-- It deletes rows only. Storage objects cannot be removed from SQL, so the
-- function returns the storage paths of every row it removed and the action
-- deletes those objects after the transaction has committed. That order is the
-- harmless one: if the object removal fails, an object with no row is wasted
-- space that nothing offers anyone, whereas removing objects first and then
-- having the transaction refuse would leave a row pointing at nothing.

create or replace function public.remove_import_deliverable(
  p_product_id uuid,
  p_asset_id uuid
)
returns setof text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_target public.product_assets;
begin
  perform 1
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'deliverable_not_found' using errcode = 'P0002';
  end if;

  -- The buyer-file types are the ones lib/imports/queries.ts listDeliverables
  -- reads for the buyer-files step. Anything else is not a file this action
  -- removes, whatever its id.
  select * into v_target
  from public.product_assets
  where id = p_asset_id
    and product_id = p_product_id
    and asset_type in ('deliverable', 'archive', 'source_file');

  if not found then
    raise exception 'deliverable_not_found' using errcode = 'P0002';
  end if;

  if v_target.asset_state = 'ready' and not exists (
    select 1
    from public.product_assets
    where product_id = p_product_id
      and id <> p_asset_id
      and asset_type in ('deliverable', 'archive', 'source_file')
      and asset_state = 'ready'
  ) then
    raise exception 'only_ready_deliverable' using errcode = 'P0001';
  end if;

  -- The paths first: derivatives go by the foreign key's cascade, which a
  -- RETURNING on the parent delete would not report.
  return query
  select storage_path
  from public.product_assets
  where workspace_id = v_target.workspace_id
    and (id = p_asset_id or derived_from = p_asset_id);

  delete from public.product_assets
  where id = p_asset_id
    and workspace_id = v_target.workspace_id;
end;
$$;

comment on function public.remove_import_deliverable(uuid, uuid) is
  'Removes one buyer file from a product unless it is the last ready one, serialized per product. Returns the storage paths of the removed rows, for the caller to delete after commit. Security invoker: runs under the caller''s RLS.';

revoke all on function public.remove_import_deliverable(uuid, uuid) from public, anon;
grant execute on function public.remove_import_deliverable(uuid, uuid) to authenticated;
