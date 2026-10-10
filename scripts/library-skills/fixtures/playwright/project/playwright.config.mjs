import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "workflow.spec.mjs",
  workers: 1,
  retries: 0,
  timeout: 15000,
  forbidOnly: true,
  projects: [
    { name: "chromium", use: { browserName: "chromium", headless: true } },
  ],
});
