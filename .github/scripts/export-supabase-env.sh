#!/usr/bin/env bash
#
# Publishes the running local Supabase stack's URL and keys into $GITHUB_ENV.
#
# These are read from `supabase status` rather than hardcoded, because the ports
# live in supabase/config.toml and have already moved once. A workflow that
# assumes 54321 fails with "fetch failed", which looks like a broken test rather
# than a wrong port, and costs an hour to diagnose.
#
# Both the NEXT_PUBLIC_ names the app reads and the bare names the test harness
# prefers are exported, so neither has to know about the other.
set -euo pipefail

status_file="$(mktemp)"
supabase status -o env 2>/dev/null \
  | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' \
  > "$status_file"

# shellcheck disable=SC1090
. "$status_file"

: "${API_URL:?supabase status did not report an API_URL; is the stack running?}"
: "${ANON_KEY:?supabase status did not report an ANON_KEY}"
: "${SERVICE_ROLE_KEY:?supabase status did not report a SERVICE_ROLE_KEY}"

{
  echo "NEXT_PUBLIC_SUPABASE_URL=${API_URL}"
  echo "SUPABASE_URL=${API_URL}"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
} >> "${GITHUB_ENV:?GITHUB_ENV is not set; this script only runs in Actions}"

rm -f "$status_file"
echo "Pointed the suite at ${API_URL}"
