import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL("./project/", import.meta.url));
const vitestPackage = require.resolve("vitest/package.json");
const vitestRoot = dirname(vitestPackage);

export async function verify({ scratchRoot = tmpdir() } = {}) {
  const manifest = JSON.parse(await readFile(vitestPackage, "utf8"));
  assert.equal(manifest.version, "4.1.11");
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, "pmcp-vitest-"));
  await cp(sourceRoot, directory, { recursive: true });
  await mkdir(join(directory, "node_modules"));
  await symlink(vitestRoot, join(directory, "node_modules", "vitest"), "dir");
  const reportPath = join(directory, "report.json");
  const run = spawnSync(
    process.execPath,
    [
      join(vitestRoot, "vitest.mjs"),
      "run",
      "--root",
      directory,
      "--config",
      join(directory, "vitest.config.mjs"),
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    { cwd: directory, timeout: 60_000, encoding: "utf8", maxBuffer: 1_000_000 },
  );
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.success, true);
  assert.equal(report.numTotalTests, 8);
  assert.equal(report.numPassedTests, 8);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0);
  const assertions = report.testResults.flatMap(
    (suite) => suite.assertionResults,
  );
  assert.equal(assertions.length, 8);
  assert.equal(
    assertions.every((result) => result.status === "passed"),
    true,
  );
  return {
    productId: "vitest",
    verifiedOn: new Date().toISOString(),
    verifiedVersions: [manifest.version],
    examplesExecuted: 8,
    environment: `Node ${process.versions.node}; Vitest node environment; one worker`,
    checks: assertions.map((result) => result.fullName),
    expectedFailureTests: 1,
    skippedTests: 0,
    evidenceDirectory: directory,
  };
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const result = await verify();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
