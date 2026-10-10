import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageVersions } from "../vite7/packages.mjs";

function lint(cli, args, cwd, expectedStatus) {
  const result = spawnSync(process.execPath, [cli, ...args, "--format=json"], {
    cwd,
    timeout: 30000,
    encoding: "utf8",
    maxBuffer: 1000000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expectedStatus,
    `${result.stdout}\n${result.stderr}`,
  );
  return {
    command: [process.execPath, cli, ...args, "--format=json"],
    exitCode: result.status,
    results: JSON.parse(result.stdout),
  };
}

export async function verifyLint({ scratchRoot, major }) {
  const dependencyRoot = resolve(scratchRoot);
  const require = createRequire(join(dependencyRoot, "package.json"));
  const packages = await packageVersions(require, [
    "eslint",
    "typescript-eslint",
    "typescript",
  ]);
  assert.equal(Number(packages.eslint.split(".")[0]), major);
  const directory = await mkdtemp(join(dependencyRoot, `pmcp-lint${major}-`));
  try {
    await cp(fileURLToPath(new URL("./project/", import.meta.url)), directory, {
      recursive: true,
    });
    await symlink(
      join(dependencyRoot, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    await cp(
      join(directory, "plain.fixture.txt"),
      join(directory, "plain.mjs"),
    );
    await cp(
      join(directory, "ignored.fixture.txt"),
      join(directory, "ignored.mjs"),
    );
    const cli = join(
      dirname(require.resolve("eslint/package.json")),
      "bin",
      "eslint.js",
    );
    const commands = [];
    const initial = lint(
      cli,
      [
        "plain.mjs",
        "valid.ts",
        "invalid.ts",
        "ignored.mjs",
        "--no-warn-ignored",
      ],
      directory,
      1,
    );
    commands.push(initial);
    const messages = initial.results.flatMap((result) => result.messages);
    assert.equal(messages.length, 2);
    assert.ok(messages.some((message) => message.ruleId === "semi"));
    assert.ok(
      messages.some(
        (message) =>
          message.ruleId === "@typescript-eslint/no-floating-promises",
      ),
    );
    commands.push(lint(cli, ["plain.mjs", "--fix"], directory, 0));
    assert.match(await readFile(join(directory, "plain.mjs"), "utf8"), /1;/);
    const clean = lint(
      cli,
      [
        "plain.mjs",
        "valid.ts",
        "ignored.mjs",
        "--no-warn-ignored",
        "--max-warnings=0",
      ],
      directory,
      0,
    );
    commands.push(clean);
    assert.ok(
      clean.results.every(
        (result) => result.errorCount === 0 && result.warningCount === 0,
      ),
    );
    return {
      productId: "eslint",
      companionProductIds: ["typescript-eslint"],
      verifiedOn: new Date().toISOString(),
      verifiedVersions: [packages.eslint],
      packages,
      examplesExecuted: 4,
      checks: [
        "flat configuration selects intended files",
        "projectService detects floating promise",
        "CLI fix changes invalid JavaScript",
        "clean files pass without warnings and ignored malformed source is skipped",
      ],
      commands,
      environment: `Node ${process.versions.node}; ESLint CLI; TypeScript project service`,
      cleanedUp: true,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
