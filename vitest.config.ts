import { defineConfig } from "vitest/config";

// bun-tests/ needs the bun runtime for bun:sqlite and bun:test. It is run by
// the test script through bun test, not here.
export default defineConfig({
  test: { include: ["__tests__/**/*.test.ts"] },
});
