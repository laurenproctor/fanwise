-- Licence, ownership, and the source a draft was replaced from.
--
-- ---------------------------------------------------------------------------
-- The licence model, and why it is this small
-- ---------------------------------------------------------------------------
--
-- Fanwise had no licence model before this migration. `products.license_summary`
-- is one free-text column, and `asset_type` has a `license` member for a file a
-- creator uploads. That is all. So rather than build a licence generator, this
-- adds the smallest thing that can answer "which licence, exactly, did this
-- creator accept, and when":
--
--   license_id           a key from a catalogue that lives in code
--   license_version      the version of that catalogue entry's text
--   license_accepted_at  when a person chose it
--
-- `license_summary` keeps its meaning and its readers: the FactSheet derives
-- from it, every channel adapter reads it, and the public product page renders
-- it. Nothing downstream changes. The three columns beside it record provenance
-- that a single free-text field cannot: if the wording of the `commercial`
-- preset changes next year, a product that accepted version 1 still says
-- version 1, and the text it agreed to is recoverable from the catalogue.
--
-- What is deliberately absent, and would be a different feature:
--
--   * no `licenses` table, and so no per-workspace custom licence catalogue
--   * no licence documents, no PDF, no rendering of terms
--   * no per-channel licence mapping
--   * no versioning machinery beyond a string the catalogue owns
--
-- A creator writing their own terms is `license_id = 'custom'` with a version
-- of `own`, and their words in `license_summary`. That is the whole of it.
--
-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
--
-- `rights_confirmed_at` and `rights_confirmed_by` arrived with the import
-- migration. This adds the version of the sentence that was agreed to, because
-- an attestation whose wording nobody recorded is an attestation to nothing in
-- particular, and the second disclosure: which third-party components a
-- creator says the product contains.
--
-- Both are the creator's statement. Fanwise records it; Fanwise does not
-- determine whether it is true, and the copy on the screen says so.

-- ---------------------------------------------------------------------------
-- products: the licence
-- ---------------------------------------------------------------------------

alter table public.products
  add column license_id text,
  add column license_version text,
  add column license_accepted_at timestamptz;

comment on column public.products.license_id is
  'Which catalogue entry was chosen. The catalogue is code, in lib/imports/licenses.ts.';
comment on column public.products.license_version is
  'The version of that entry''s text at the moment it was accepted. Never rewritten.';

-- A licence is a key, a version and a time, or it is none of them. Two of the
-- three is a row nobody can interpret later.
alter table public.products
  add constraint products_license_choice_complete check (
    (license_id is null) = (license_version is null)
    and (license_id is null) = (license_accepted_at is null)
  );

-- A chosen licence has to say something. The application checks this too, and
-- readiness reads the summary rather than the key for exactly this reason; the
-- constraint is what stops a row reaching that state by another path.
alter table public.products
  add constraint products_license_has_terms check (
    license_id is null or length(btrim(coalesce(license_summary, ''))) > 0
  );

-- ---------------------------------------------------------------------------
-- products: ownership, and the second disclosure
-- ---------------------------------------------------------------------------

alter table public.products
  add column rights_attestation_version text,
  add column third_party_components text,
  add column third_party_declared_at timestamptz;

comment on column public.products.rights_attestation_version is
  'The version of the sentence the creator agreed to. Recorded so the exact wording is recoverable.';
comment on column public.products.third_party_components is
  'What the creator says the product contains that is not theirs. Null once declared means they said none.';
comment on column public.products.third_party_declared_at is
  'When the creator answered the third-party question. Null means they have not.';

-- The attestation is all three or none. The earlier constraint held the first
-- two together; this replaces it so the version cannot drift loose from them.
alter table public.products
  drop constraint products_rights_confirmation_complete;

alter table public.products
  add constraint products_rights_confirmation_complete check (
    (rights_confirmed_at is null) = (rights_confirmed_by is null)
    and (rights_confirmed_at is null) = (rights_attestation_version is null)
  );

-- A component list without a declaration time is a list nobody submitted.
alter table public.products
  add constraint products_third_party_declared check (
    third_party_components is null or third_party_declared_at is not null
  );

-- ---------------------------------------------------------------------------
-- product_imports: what the source said last time
-- ---------------------------------------------------------------------------
--
-- Replacing a source must show a creator what changed before anything moves.
-- The comparison needs both readings, so the runner keeps the one it is about
-- to replace. One reading back, not a history: the question is "what is
-- different from what I looked at", and the answer to that is the previous
-- reading and no older one.

alter table public.product_imports
  add column previous_evidence jsonb,
  add column previous_content_hash text;

comment on column public.product_imports.previous_evidence is
  'The reading this one replaced, for the change preview. One back, never a history.';

alter table public.product_imports
  add constraint product_imports_previous_hash_shape check (
    previous_content_hash is null or previous_content_hash ~ '^[0-9a-f]{64}$'
  );
