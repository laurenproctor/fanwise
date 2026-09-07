-- What the last write to a channel had to say that was not an error.
--
-- The case this exists for: Shopify fetches an image URL on its own schedule,
-- after the mutation has already returned success, so a fetch that never
-- happened produces a published product with no image and nothing anywhere
-- recording that. The publish did not fail. The listing is live and
-- purchasable. It is simply missing the picture, and until now the only way to
-- find out was to open the channel's own admin and look.
--
-- Deliberately not an error column. publication_jobs already carries
-- normalized_error_code and normalized_error_message for a write that failed,
-- and putting a non-fatal remark there would make a succeeded job look failed.
-- This is the other thing: the write worked, and there is still something the
-- creator should know.
--
-- Nullable, and cleared by every write that has nothing to say, so the columns
-- describe the most recent write rather than accumulating history. Snapshots
-- are where history lives.
alter table channel_listings
  add column last_notice_code text,
  add column last_notice_message text;

comment on column channel_listings.last_notice_code is
  'Normalized, non-fatal remark from the most recent successful write. Null when that write had nothing to report.';

comment on column channel_listings.last_notice_message is
  'Creator-facing text for last_notice_code. Never a raw provider string.';
