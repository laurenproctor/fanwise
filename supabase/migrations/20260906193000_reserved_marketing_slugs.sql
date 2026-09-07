-- The marketing site takes seven top-level path segments.
--
-- `/about`, `/how-it-works`, `/marketplaces`, `/pricing`, `/privacy`, `/start`
-- and `/terms` are now static routes, and a workspace slugged with any of them
-- would insert happily and be unreachable forever, because Next resolves a
-- static segment before a dynamic one. Same rule as 20260905173722, same fix.
--
-- Kept in step with RESERVED_WORKSPACE_SLUGS in lib/slug.ts, which a unit test
-- checks against the actual route tree.

alter table public.workspaces
  drop constraint workspaces_slug_not_reserved;

alter table public.workspaces
  add constraint workspaces_slug_not_reserved check (
    slug <> all (
      array[
        'about',
        'api',
        'auth',
        'forgot-password',
        'how-it-works',
        'marketplaces',
        'onboarding',
        'pricing',
        'privacy',
        'reset-password',
        'sign-in',
        'sign-up',
        'start',
        'terms'
      ]
    )
  );
