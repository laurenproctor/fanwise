import { defineConfig } from "vitest/config"
import { fileURLToPath } from "url"

/**
 * Tenancy suite. Separate from the unit config because these tests need a live
 * Supabase (`supabase start`) and must not run in parallel against one database.
 *
 * ## Running it
 *
 * Nothing here loads `.env.local`, deliberately. That file points at whichever
 * project the app is currently developed against, which has at times been a
 * hosted one, and these tests create users, publish listings and delete rows.
 * A config that helpfully found some credentials would eventually find the
 * wrong ones. So the variables are the caller's to supply, and the suite is
 * unrunnable by accident:
 *
 *     eval "$(supabase status -o env | sed 's/^/export LOCAL_/')"
 *     export SUPABASE_URL="$LOCAL_API_URL" \
 *            SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" \
 *            SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY" \
 *            NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL" \
 *            NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" \
 *            NEXT_PUBLIC_APP_URL="http://localhost:3001" \
 *            CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
 *     pnpm test:db
 *
 * ## Why six variables and not three
 *
 * This is the part worth writing down, because getting it wrong does not look
 * like getting it wrong.
 *
 * `tests/db/harness.ts` reads the first three and says so plainly when one is
 * missing. But several suites reach production code that calls
 * `createAdminClient`, which goes through `lib/env.ts` and independently
 * demands the three `NEXT_PUBLIC_` variables. Supply only the harness's three
 * and the run does not refuse to start: it starts, the tenancy files pass, and
 * 23 tests across derivative-pipeline, publication-idempotency and
 * publication-update fail with a stack pointing into `lib/env.ts`. It reads
 * like a broken build rather than a missing export, and costs an afternoon to
 * trace back to this line.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is not read by any test today. It is here
 * because it is lazy — `lib/credentials/keyring.ts` throws on first use rather
 * than at boot — so the first suite that touches a real credential will need
 * one, and a throwaway key costs nothing now.
 *
 * ## Before the first run after a schema change
 *
 * `supabase db reset`, which is local-only. The suite asserts against columns
 * and constraints, so a local database a migration behind fails in ways that
 * describe the schema rather than the code. The reset also leaves the local
 * database clean, which the suite itself does not: actors are created per file
 * and their workspaces accumulate across runs.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
})
