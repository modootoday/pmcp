import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["workflow.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    testTimeout: 5000,
    hookTimeout: 5000,
    clearMocks: true,
  },
});
