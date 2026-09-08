-- The enum value added in the previous migration cannot be referenced in the
-- transaction that added it, so the constraint tying `field` to the type lives
-- one migration later.
alter table public.ai_generations
  add constraint ai_generations_field_matches_type check (
    (generation_type = 'field') = (field is not null)
  );
