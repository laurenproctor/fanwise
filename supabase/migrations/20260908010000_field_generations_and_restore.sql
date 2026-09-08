-- Step B2: the listing review.
--
-- Two enum members and one column. The review screen regenerates a single
-- field, and restores an earlier generation, and both need the schema to say
-- so honestly rather than reusing the whole-listing shape and hoping.
--
--   ai_generation_type 'field'   one field of a listing, named in `field`
--   ai_generations.field         which one. Present exactly when the type is
--                                'field', by check constraint.
--   snapshot_type 'restore'      an earlier generation's copy put back on the
--                                listing by a person. A restore is not a
--                                generation: no model was called, and a history
--                                that recorded it as one would answer "what
--                                changed before revenue moved" with a call
--                                that never happened.

alter type public.ai_generation_type add value if not exists 'field';
alter type public.snapshot_type add value if not exists 'restore';

alter table public.ai_generations
  add column field text;

alter table public.ai_generations
  add constraint ai_generations_field_known check (
    field is null
    or field in ('title', 'description', 'shortDescription', 'seoTitle', 'seoDescription', 'tags')
  );

-- The field names are the listing output's keys, as lib/ai/output.ts spells
-- them, rather than the column names. A row is read back into that shape and
-- never joined on this value.
comment on column public.ai_generations.field is
  'For generation_type = field: which listing field was regenerated. Null otherwise.';
