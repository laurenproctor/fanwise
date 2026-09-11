-- Step A6: a PKCE verifier on the authorization state.
--
-- Etsy's OAuth is authorization code with PKCE. The verifier is minted when
-- the flow starts and presented at the token exchange, so it has to survive
-- the round trip through the creator's browser without ever being in it. The
-- state row is where the rest of what the callback must not choose for itself
-- already lives, and this table has no grant to anon or authenticated, so the
-- verifier is unreachable through PostgREST like everything else on the row.
--
-- Nullable: a provider without PKCE writes none.
alter table public.channel_oauth_states
  add column code_verifier text;

comment on column public.channel_oauth_states.code_verifier is
  'PKCE code_verifier for providers that require it. Service role only, like the rest of the row.';
