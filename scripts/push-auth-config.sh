#!/usr/bin/env bash
# Applies supabase/config.toml, with its [remotes.production] overrides, to the
# hosted Supabase project. Run as `pnpm auth:push`.
#
# The SMTP block in that file reads four env() values. The Supabase CLI takes
# them from the shell environment, not from .env.local, so this script loads
# them from .env.local first. It then refuses to push while any of the four is
# blank: a push with the block half-filled would enable SMTP with an empty host
# and stop every auth email on the hosted project.
#
# The CLI prints the diff between the file and the project and asks before
# applying it. Read the diff. The secret is shown hashed, not in clear.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="whepzmlbhhuxjswezall"
ENV_FILE="${ENV_FILE:-.env.local}"
REQUIRED=(SMTP_HOST SMTP_USER SMTP_PASS SMTP_ADMIN_EMAIL)

# A value already in the environment wins. Otherwise read it from the env file,
# stripping one layer of surrounding double quotes.
for key in "${REQUIRED[@]}"; do
  if [ -z "${!key:-}" ] && [ -f "$ENV_FILE" ]; then
    value=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
    export "$key=$value"
  fi
done

missing=()
for key in "${REQUIRED[@]}"; do
  [ -z "${!key:-}" ] && missing+=("$key")
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Not pushing. These are blank in the environment and in $ENV_FILE:" >&2
  for key in "${missing[@]}"; do echo "  $key" >&2; done
  echo "" >&2
  echo "The hosted project is unchanged. Set all four (see .env.example) and rerun." >&2
  exit 1
fi

echo "Pushing supabase/config.toml to project $PROJECT_REF with SMTP from $ENV_FILE."
echo "Review the diff the CLI shows before confirming."
exec supabase config push --project-ref "$PROJECT_REF"
