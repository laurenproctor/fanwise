import next from "eslint-config-next"
import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Rule 4 in CLAUDE.md: avoid `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [
      ".next/**",
      // Worktrees for parallel sessions: whole copies of the repo, linted in their own checkouts.
      ".claude/**",
      // The Trigger.dev worker's build cache. Bundled vendor code, not ours.
      ".trigger/**",
      "node_modules/**",
      "supabase/.temp/**",
      "design/**",
      "lib/supabase/database.types.ts",
    ],
  },
]

export default config
