import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    globalSetup: ["__tests__/setup/isolation.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
