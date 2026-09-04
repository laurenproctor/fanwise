-- Step A0: foundation only.
-- No domain tables. Workspaces and tenancy arrive in step A1, products in A2.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- Shared trigger for updated_at columns, used by every table from A1 onward.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Sets updated_at to now() on UPDATE. Attach with: create trigger set_updated_at before update on <table> for each row execute function public.set_updated_at();';
