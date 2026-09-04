import { defineConfig } from "vitest/config"
import { fileURLToPath } from "url"

/**
 * Tenancy suite. Separate from the unit config because these tests need a live
 * Supabase (`supabase start`) and must not run in parallel against one database.
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
