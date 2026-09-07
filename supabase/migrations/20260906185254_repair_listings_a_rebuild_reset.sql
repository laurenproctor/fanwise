-- ---------------------------------------------------------------------------
-- Repair listings that a rebuild reset after they had been published.
--
-- buildListing was one upsert whose on-conflict payload included `status`,
-- `status_source` and `metadata`. Rebuilding an already-published listing
-- therefore reset it to draft and self_reported while leaving
-- external_listing_id, published_at and last_synced_at in place: a row that
-- says the product was never published, next to three columns recording
-- exactly when it was. The code was fixed in "Stop a rebuild claiming the
-- listing was never published"; a rebuild now touches only the draft columns.
--
-- That fix stops the damage from recurring. It does not undo damage already
-- written, which is what this migration is for.
--
-- Scope is narrow on purpose. `verified` means a provider API confirmed the
-- state, so the condition that matters is not the shape of the row but the
-- existence of a succeeded publication job behind it. A row is repaired only
-- when Fanwise actually has that evidence.
--
-- Deliberately does NOT restore `metadata.externalState`, which the same
-- upsert also blanked. That field records whether the channel currently holds
-- the product live or as a draft, and no query in this database can establish
-- it — only the provider knows. Writing a guess here would assert a provider
-- fact from local inference, which is the same mistake in a different place.
-- It is left absent, and the adapter is being changed to treat absence as
-- unknown rather than as a draft.
--
-- Idempotent: after it runs, no row matches its own predicate.
-- ---------------------------------------------------------------------------

update public.channel_listings as l
set
  status = 'published',
  status_source = 'verified'
where
  l.status = 'draft'
  and l.status_source = 'self_reported'
  -- The three columns the same upsert left behind, which are what make the
  -- draft claim self-contradicting rather than merely stale.
  and l.external_listing_id is not null
  and l.published_at is not null
  -- The actual warrant for `verified`. Without a succeeded job there is no API
  -- confirmation to restore, and the row is left alone.
  and exists (
    select 1
    from public.publication_jobs j
    where j.channel_listing_id = l.id
      and j.workspace_id = l.workspace_id
      and j.status = 'succeeded'
  )
  -- enforce_listing_status_source raises on `verified` for an assisted
  -- channel. Such a row should never reach the predicate above, since an
  -- assisted channel has no publish method to succeed with. Stated anyway:
  -- were one to exist, the trigger would abort this migration rather than
  -- skip the row.
  and exists (
    select 1
    from public.channels c
    where c.id = l.channel_id
      and c.integration_type = 'api'
  );
