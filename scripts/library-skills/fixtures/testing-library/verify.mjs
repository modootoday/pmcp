import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersions } from "../vite7/packages.mjs";

export async function verify({ scratchRoot }) {
  const dependencyRoot = resolve(scratchRoot);
  const require = createRequire(join(dependencyRoot, "package.json"));
  const packages = await packageVersions(require, [
    "@testing-library/react",
    "@testing-library/dom",
    "@testing-library/user-event",
    "react",
    "react-dom",
    "vitest",
    "jsdom",
  ]);
  const directory = await mkdtemp(
    join(dependencyRoot, "pmcp-testing-library-"),
  );
  try {
    await cp(fileURLToPath(new URL("./project/", import.meta.url)), directory, {
      recursive: true,
    });
    await symlink(
      join(dependencyRoot, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const reportPath = join(directory, "report.json");
    const cli = join(
      dirname(require.resolve("vitest/package.json")),
      "vitest.mjs",
    );
    const args = [
      cli,
      "run",
      "--root",
      directory,
      "--config",
      join(directory, "vitest.config.mjs"),
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ];
    const run = spawnSync(process.execPath, args, {
      cwd: directory,
      timeout: 60000,
      encoding: "utf8",
      maxBuffer: 1000000,
    });
    if (run.error) throw run.error;
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.success, true);
    assert.equal(report.numPassedTests, 3);
    assert.equal(report.numFailedTests, 0);
    assert.equal(report.numPendingTests, 0);
    const assertions = report.testResults.flatMap(
      (result) => result.assertionResults,
    );
    assert.ok(assertions.every((result) => result.status === "passed"));
    return {
      productId: "testing-library-react",
      verifiedOn: new Date().toISOString(),
      verifiedVersions: [packages["@testing-library/react"]],
      packages,
      examplesExecuted: assertions.length,
      checks: assertions.map((result) => result.fullName),
      environment: `Node ${process.versions.node}; Vitest jsdom; one worker`,
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
