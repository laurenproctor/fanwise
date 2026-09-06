-- ---------------------------------------------------------------------------
-- What was last actually sent to the channel.
--
-- The update path exists end to end — startPublication takes `kind: "update"`,
-- updateKey hashes the draft and the images, the runner dispatches to
-- adapter.update — and nothing calls it, because the UI had no honest way to
-- decide when to offer it. A button that is always present is a button whose
-- outcome is usually `already_done`, which is the same lie the panel already
-- refuses to tell with a second Publish.
--
-- Answering "is there anything to send?" needs a record of what went last, and
-- there was none. A publish snapshot does not carry the image list (only a
-- build snapshot passes it), so the history cannot answer it either.
--
-- This column is that record: the two hashes updateKey is built from, written
-- by recordSuccess after a successful external write. The UI compares the
-- listing's current fingerprint against it, so the question the UI asks and the
-- question the idempotency key answers come from one definition and cannot
-- drift apart.
--
-- Nullable, and null means unknown rather than unchanged. Every listing
-- published before this column existed has null, which correctly reads as
-- "cannot prove there is nothing to send" and offers the action.
-- ---------------------------------------------------------------------------

alter table public.channel_listings
  add column last_sent_fingerprint text;

comment on column public.channel_listings.last_sent_fingerprint is
  'The content and image fingerprint of the last successful external write, from sentFingerprint(). Null means nothing is recorded, not that nothing changed.';
