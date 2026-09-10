#!/usr/bin/env bash
# Applies supabase/config.toml, with its [remotes.<name>] overrides, to a hosted
# Supabase project. Run as:
#
#   pnpm auth:push -- --project-ref <ref> --commit <sha> [--env-file <path>]
#
# This is a hosted mutation, and it is held to the same boundary as a database
# migration (docs/decisions/0008-transactional-email.md, "Deploying it"):
#
#   1. The commit is named explicitly and must be on origin/main. Nothing is
#      pushed from a working tree, a branch, or a checkout with local edits.
#   2. The push runs from a temporary detached worktree created from that
#      commit, at a unique path, never from a routine checkout. That worktree
#      is the only thing linked to the project, and it is unlinked and removed
#      on every exit: success, refusal, a CLI failure, Ctrl-C.
#   3. The project reference is an argument, never a default. Immediately after
#      linking, the worktree's supabase/.temp/project-ref is read back and has
#      to equal the argument exactly, or the run unlinks and stops.
#   4. `supabase config push` has no dry run (CLI 2.101.0: its only flag is
#      --project-ref). It prints the diff between the file and the project and
#      asks before applying. That prompt, answered by a person at a terminal,
#      is the final approval boundary, so this script never passes --yes and
#      refuses to run without a terminal on stdin.
#
# The SMTP block in config.toml reads four env() values. The CLI takes them
# from the environment. They reach this script from the environment it was
# started with or from an env file named with --env-file, which has to live
# outside the repository: nothing is copied into the worktree, nothing is
# printed, and the script refuses to push while any of the four is blank,
# because a half-filled block would enable SMTP with an empty host and stop
# every auth email on the hosted project.
set -euo pipefail

REQUIRED=(SMTP_HOST SMTP_USER SMTP_PASS SMTP_ADMIN_EMAIL)

usage() {
  cat >&2 <<'USAGE'
usage: pnpm auth:push -- --project-ref <ref> --commit <sha> [--env-file <path>]

  --project-ref  the hosted project to push to; there is no default
  --commit       a commit on origin/main whose supabase/config.toml is pushed
  --env-file     a file outside the repository holding SMTP_HOST, SMTP_USER,
                 SMTP_PASS and SMTP_ADMIN_EMAIL; otherwise they must already
                 be in the environment
USAGE
  exit 2
}

PROJECT_REF=""
COMMIT=""
ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project-ref) PROJECT_REF="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
[ -n "$PROJECT_REF" ] && [ -n "$COMMIT" ] || usage
[[ "$PROJECT_REF" =~ ^[a-z]{20}$ ]] || { echo "--project-ref must be a 20-letter project reference" >&2; exit 2; }

fail() { echo "$*" >&2; echo "The hosted project is unchanged." >&2; exit 1; }

# --- Credentials: environment, or an external env file. Never echoed. --------
if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || fail "--env-file $ENV_FILE does not exist."
  for key in "${REQUIRED[@]}"; do
    if [ -z "${!key:-}" ]; then
      value=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
      export "$key=$value"
    fi
  done
fi
missing=()
for key in "${REQUIRED[@]}"; do [ -z "${!key:-}" ] && missing+=("$key"); done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Not pushing. These are blank in the environment${ENV_FILE:+ and in $ENV_FILE}:" >&2
  for key in "${missing[@]}"; do echo "  $key" >&2; done
  fail "Set all four (see .env.example) and rerun."
fi

# --- A person, at a terminal. The CLI's diff prompt is the approval. ---------
[ -t 0 ] || fail "Refusing to run without a terminal: the CLI's diff prompt is the approval step and cannot be answered by a pipe."

# --- The commit: named, fetched, on origin/main. -----------------------------
REPO=$(git rev-parse --show-toplevel)
cd "$REPO"
git fetch --quiet origin
SHA=$(git rev-parse --verify --quiet "${COMMIT}^{commit}") || fail "--commit $COMMIT is not a commit this repository knows."
git merge-base --is-ancestor "$SHA" origin/main || fail "--commit $COMMIT is not on origin/main. Merge it first; nothing is pushed from a branch."

# The env file must not be inside the repository or any of its worktrees.
if [ -n "$ENV_FILE" ]; then
  env_dir=$(cd "$(dirname "$ENV_FILE")" && pwd -P)
  while IFS= read -r wt; do
    case "$env_dir/" in "$wt"/*) fail "--env-file must live outside the repository and its worktrees; $ENV_FILE is inside $wt." ;; esac
  done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
fi

# --- Nothing else may be linked. --------------------------------------------
while IFS= read -r wt; do
  [ -f "$wt/supabase/.temp/project-ref" ] && fail "$wt is linked to a hosted project. Unlink it (supabase unlink) before deploying; a routine checkout is never linked."
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')

# --- The temporary worktree, and its cleanup on every exit. ------------------
DEPLOY_DIR="$(dirname "$REPO")/fanwise-auth-deploy-$(date +%Y%m%d%H%M%S)-${SHA:0:7}"
[ -e "$DEPLOY_DIR" ] && fail "$DEPLOY_DIR already exists."

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo "" >&2
  echo "Cleanup: unlinking and removing $DEPLOY_DIR" >&2
  if [ -d "$DEPLOY_DIR" ]; then
    (cd "$DEPLOY_DIR" && supabase unlink --yes >/dev/null 2>&1) || true
    if [ -f "$DEPLOY_DIR/supabase/.temp/project-ref" ]; then
      echo "UNLINK FAILED: $DEPLOY_DIR is still linked. Run 'supabase unlink' there before anything else." >&2
      exit 1
    fi
    if [ -n "$(git -C "$DEPLOY_DIR" status --short)" ]; then
      echo "Deployment worktree is not clean; leaving it in place for inspection: $DEPLOY_DIR" >&2
      exit 1
    fi
    git -C "$REPO" worktree remove --force "$DEPLOY_DIR" >/dev/null 2>&1 || true
    git -C "$REPO" worktree prune
  fi
  while IFS= read -r wt; do
    [ -f "$wt/supabase/.temp/project-ref" ] && { echo "STILL LINKED: $wt" >&2; exit 1; }
  done < <(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}')
  echo "Every worktree is unlinked." >&2
  exit "$code"
}
trap cleanup EXIT INT TERM

git worktree add --detach --quiet "$DEPLOY_DIR" "$SHA"
cd "$DEPLOY_DIR"
[ -z "$(git status --short)" ] || fail "The deployment worktree is not clean; refusing to push from it."

# The overrides for this project have to be in the file being pushed. A push to
# a ref the file does not name would apply the local block to the hosted
# project, which is the mistake this line exists to refuse.
grep -Eq "^project_id = \"$PROJECT_REF\"$" supabase/config.toml \
  || fail "supabase/config.toml at $COMMIT declares no [remotes.*] block with project_id \"$PROJECT_REF\"."

# --- Link, verify the reference, push, and let the CLI's prompt decide. ------
supabase link --project-ref "$PROJECT_REF" >/dev/null
linked=$(cat supabase/.temp/project-ref 2>/dev/null || true)
[ "$linked" = "$PROJECT_REF" ] || fail "Linked project reference '$linked' does not equal '$PROJECT_REF'."

echo "Pushing supabase/config.toml from $COMMIT (${SHA:0:7}) to project $PROJECT_REF."
echo "Read the diff the CLI prints. Answering yes there is the deployment; answering no leaves the project unchanged."
supabase config push --project-ref "$PROJECT_REF"
