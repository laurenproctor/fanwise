-- Listing image ordering: let an image change which presentation role it holds.
--
-- A2 froze `asset_type` along with the content columns of a ready asset. That
-- was over-inclusive, and this migration narrows it rather than removing it.
--
-- The reason the immutability trigger exists is recorded in A2:
--
--     "The derivative cache key omits the source checksum, so the bytes behind
--      derived_from must never change under it."
--
-- That argument covers storage_path, filename, mime_type, byte_size, checksum,
-- derived_from and spec_hash. It does not cover `asset_type`, which is in
-- neither the cache key `(derived_from, spec_hash)` nor the bytes. Changing a
-- ready image from cover to preview invalidates no derivative: the source id is
-- the same, the spec is the same, and the pixels are the same.
--
-- So `asset_type` may now change, and ONLY between the two roles an image can
-- hold:
--
--     cover_image  <->  preview_image
--
-- Deliberately not "any type may change". Both members of that pair are image
-- types, so `isImageAssetType` cannot flip and no derivative decision changes
-- underneath a row. A deliverable that could become a cover image is a buyer's
-- zip published as a public product picture, which is the worst outcome the
-- channel image selector exists to prevent; permitting the general case to buy
-- one drag-and-drop interaction would be a bad trade.
--
-- Everything else about the trigger is unchanged, including the whole of it for
-- an asset that is not yet ready: a pending row is still free to change, because
-- nothing has depended on it yet.

create or replace function public.enforce_asset_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.asset_state <> 'ready' then
    return new;
  end if;

  -- Content. Unchanged from A2, minus asset_type, which is handled below.
  if new.asset_state is distinct from old.asset_state
    or new.storage_path is distinct from old.storage_path
    or new.filename is distinct from old.filename
    or new.mime_type is distinct from old.mime_type
    or new.byte_size is distinct from old.byte_size
    or new.checksum is distinct from old.checksum
    or new.derived_from is distinct from old.derived_from
    or new.spec_hash is distinct from old.spec_hash
    or new.product_id is distinct from old.product_id
    or new.workspace_id is distinct from old.workspace_id
  then
    raise exception 'product_assets are immutable once ready; replace the file with a new row'
      using errcode = '23514';
  end if;

  -- Presentation role. One transition, both directions, nothing else.
  if new.asset_type is distinct from old.asset_type
    and not (
      old.asset_type in ('cover_image', 'preview_image')
      and new.asset_type in ('cover_image', 'preview_image')
    )
  then
    raise exception 'a ready asset may only move between cover_image and preview_image'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_asset_immutability is
  'Blocks content changes to a ready asset, which is what makes (derived_from, spec_hash) a sound cache key without a checksum in it. asset_type may move between cover_image and preview_image only: both are image types, so no derivative decision changes underneath the row.';
