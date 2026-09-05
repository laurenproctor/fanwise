-- Slugs that a route would shadow.
--
-- The URL scheme puts a workspace slug in the first path segment and a product
-- slug in the second, sharing those segments with the application's own static
-- routes. Next resolves a static segment before a dynamic one, so a workspace
-- slugged `sign-in` is not a broken link. It is a row that inserts happily and
-- a page nobody can ever open, and nothing in the product would report it.
--
-- lib/slug.ts avoids these when it generates a slug. This is the half that
-- holds when something other than that module writes the row: a fixture, a
-- seed script, psql at 2am. The arrays here must stay in step with
-- RESERVED_WORKSPACE_SLUGS and RESERVED_PRODUCT_SLUGS, and a unit test asserts
-- both lists still cover every route that exists.

alter table public.workspaces
  add constraint workspaces_slug_not_reserved check (
    slug <> all (
      array[
        'api',
        'auth',
        'forgot-password',
        'onboarding',
        'reset-password',
        'sign-in',
        'sign-up'
      ]
    )
  );

alter table public.products
  add constraint products_slug_not_reserved check (
    slug <> all (array['assets', 'channels', 'new', 'settings'])
  );
