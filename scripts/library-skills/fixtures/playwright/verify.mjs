import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersions } from "../vite7/packages.mjs";

export async function verify({ scratchRoot }) {
  const dependencyRoot = resolve(scratchRoot);
  const require = createRequire(join(dependencyRoot, "package.json"));
  const packages = await packageVersions(require, [
    "@playwright/test",
    "playwright",
    "playwright-core",
  ]);
  const directory = await mkdtemp(join(dependencyRoot, "pmcp-playwright-"));
  try {
    await cp(fileURLToPath(new URL("./project/", import.meta.url)), directory, {
      recursive: true,
    });
    await symlink(
      join(dependencyRoot, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const lifecyclePath = join(directory, "lifecycle.txt");
    await writeFile(lifecyclePath, "");
    const cli = join(
      dirname(require.resolve("@playwright/test/package.json")),
      "cli.js",
    );
    const args = [
      cli,
      "test",
      "--config",
      join(directory, "playwright.config.mjs"),
      "--reporter=json",
    ];
    const run = spawnSync(process.execPath, args, {
      cwd: directory,
      timeout: 60000,
      encoding: "utf8",
      maxBuffer: 2000000,
      env: { ...process.env, PMCP_FIXTURE_LIFECYCLE: lifecyclePath },
    });
    if (run.error) throw run.error;
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.stats.expected, 2);
    assert.equal(report.stats.unexpected, 0);
    assert.equal(report.stats.skipped, 0);
    assert.equal(report.stats.flaky, 0);
    const lifecycle = (await readFile(lifecyclePath, "utf8"))
      .trim()
      .split("\n");
    assert.equal(
      lifecycle.filter((line) => line.startsWith("setup:")).length,
      2,
    );
    assert.equal(
      lifecycle.filter((line) => line.startsWith("teardown:")).length,
      2,
    );
    const browser = require("playwright").chromium.executablePath();
    return {
      productId: "playwright-test",
      verifiedOn: new Date().toISOString(),
      verifiedVersions: [packages["@playwright/test"]],
      packages,
      examplesExecuted: 3,
      checks: [
        "accessible locator interaction in Chromium",
        "runner browser context isolation",
        "auto fixture setup and teardown",
      ],
      environment: `Node ${process.versions.node}; Chromium; one worker; zero retries`,
      browserExecutable: browser,
      command: [process.execPath, ...args],
      exitCode: run.status,
      cleanedUp: true,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(JSON.stringify(await verify({ scratchRoot: process.argv[2] })));
}
