import { appendFile, readFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";

const test = base.extend({
  lifecycle: [
    async ({}, use, testInfo) => {
      await appendFile(
        process.env.PMCP_FIXTURE_LIFECYCLE,
        `setup:${testInfo.title}\n`,
      );
      await use();
      await appendFile(
        process.env.PMCP_FIXTURE_LIFECYCLE,
        `teardown:${testInfo.title}\n`,
      );
    },
    { auto: true },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.setContent(
    await readFile(new URL("./app.html", import.meta.url), "utf8"),
  );
});

test("accessible locator interaction updates browser state", async ({
  page,
}) => {
  await expect(page.getByRole("status")).toHaveText("0");
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("1");
});

test("new test context starts with independent state", async ({ page }) => {
  await expect(page.getByRole("status")).toHaveText("0");
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("2");
});
