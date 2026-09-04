import { defineConfig } from "vitest/config"
import { fileURLToPath } from "url"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    // Image encoding through sharp is legitimately slow; the default 5s is
    // too tight for the derivative suite.
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
})
