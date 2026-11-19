# Hosting on Netlify

Opened on 18 November 2026 at the founder's request, after Vercel refused deployments with
"Account is blocked". The app is unchanged: Supabase still holds login, the database and
files, and Trigger.dev still runs background jobs. Netlify only runs the Next.js app.

## What is in the repo

- `netlify.toml`: build command, publish directory, Node 24, and the pnpm flag Netlify's
  Next.js adapter needs. The adapter itself is not pinned; Netlify supplies it per build.
- `next.config.ts` inlines Netlify's build-time `CONTEXT` as `FANWISE_NETLIFY_CONTEXT`,
  because a Netlify function cannot read `CONTEXT` at runtime. `environmentFrom` in
  `lib/security/headers.ts` treats Netlify's production context as production, so HSTS and
  upgraded requests still apply. Deploy previews and branch deploys get the production
  policy without HSTS.
- Analytics is Google Analytics 4 (`lib/analytics/ga.ts`), which does not depend on the host.

## What a person does in Netlify

1. Create the site from the GitHub repo. Leave the build settings as `netlify.toml` gives them.
2. Add every variable in `.env.example` under the site's environment variables, with the
   production values. Variables in `netlify.toml` do not reach server code at runtime, so
   secrets must be set in the Netlify UI, CLI or API.
3. Set `NEXT_PUBLIC_APP_URL` to the new address.

## What changes with the address

Unless a custom domain sits in front, the address moves off `fanwise.vercel.app`. Update:

- Supabase Auth: the site URL and the redirect allow-list.
- Shopify, Etsy and Gumroad: the OAuth redirect URLs on each app registration.
- Stripe: the webhook endpoint.
- The companion window handoff address in `docs/artifact-import.md`.

## Known limits to test after the first deploy

- Netlify's buffered request limit is 6 MB, and binary uploads are Base64-encoded, which
  brings the usable size to about 4.5 MB. Profile avatars allow 5 MiB, so the largest
  avatars will be refused, as they already were on Vercel.
- Synchronous requests stop at 60 seconds.
