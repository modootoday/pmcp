import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["workflow.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 5000,
  },
});
