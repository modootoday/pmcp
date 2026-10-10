import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersions } from "../vite7/packages.mjs";

function run(cli, args, cwd, expectedStatus) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    timeout: 20000,
    encoding: "utf8",
    maxBuffer: 1000000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    expectedStatus,
    `${result.stdout}\n${result.stderr}`,
  );
  return { command: [process.execPath, cli, ...args], exitCode: result.status };
}

export async function verify({ scratchRoot }) {
  const dependencyRoot = resolve(scratchRoot);
  const require = createRequire(join(dependencyRoot, "package.json"));
  const semver = require("semver");
  const YAML = require("yaml");
  const toml = require("smol-toml");
  const prettier = require("prettier");
  const packages = await packageVersions(require, [
    "semver",
    "yaml",
    "smol-toml",
    "prettier",
  ]);
  const directory = await mkdtemp(join(dependencyRoot, "pmcp-configuration-"));
  const checks = [];
  try {
    await cp(fileURLToPath(new URL("./project/", import.meta.url)), directory, {
      recursive: true,
    });
    await cp(
      join(directory, "format", "unformatted.fixture.txt"),
      join(directory, "format", "unformatted.ts"),
    );
    await cp(
      join(directory, "format", "ignored.fixture.txt"),
      join(directory, "format", "ignored.ts"),
    );
    assert.equal(semver.valid("not-a-version"), null);
    assert.equal(semver.satisfies("0.3.9", "^0.3.0"), true);
    assert.equal(semver.satisfies("0.4.0", "^0.3.0"), false);
    checks.push("semver: zero-major range and invalid version handling");
    assert.equal(semver.satisfies("1.3.0-beta.1", "^1.2.0"), false);
    assert.equal(
      semver.satisfies("1.3.0-beta.1", "^1.2.0", { includePrerelease: true }),
      true,
    );
    assert.equal(semver.intersects("^1.2.0", ">=1.4.0 <2.0.0"), true);
    checks.push("semver: explicit prerelease policy and range intersection");

    const document = YAML.parseDocument(
      await readFile(join(directory, "settings.yaml"), "utf8"),
    );
    assert.equal(document.errors.length, 0);
    document.setIn(["service", "port"], 9000);
    assert.match(document.toString(), /# Application connection settings/);
    assert.equal(YAML.parse(document.toString()).service.port, 9000);
    checks.push("yaml: structured update preserves comment and value");
    assert.ok(YAML.parseDocument("key: 1\nkey: 2\n").errors.length > 0);
    checks.push("yaml: duplicate key diagnostic");
    const aliases = YAML.parseDocument(
      "base: &base { value: 1 }\ncopy: *base\n",
    );
    assert.throws(() => aliases.toJS({ maxAliasCount: 0 }));
    checks.push("yaml: bounded alias conversion");

    const settings = toml.parse(
      await readFile(join(directory, "settings.toml"), "utf8"),
    );
    settings.service.host = "example.test";
    assert.deepEqual(toml.parse(toml.stringify(settings)), settings);
    checks.push("smol-toml: nested configuration roundtrip");
    assert.throws(() => toml.parse("value = 1\nvalue = 2\n"));
    checks.push("smol-toml: duplicate key rejection");
    const integers = toml.parse("large = 9223372036854775807\n", {
      integersAsBigInt: true,
    });
    assert.equal(integers.large, 9223372036854775807n);
    assert.equal(
      toml.parse(toml.stringify(integers), { integersAsBigInt: true }).large,
      integers.large,
    );
    checks.push("smol-toml: signed 64-bit integer preservation");

    const sourcePath = join(directory, "format", "unformatted.ts");
    const options = await prettier.resolveConfig(sourcePath);
    assert.equal(options.semi, true);
    const source = await readFile(sourcePath, "utf8");
    const formatted = await prettier.format(source, {
      ...options,
      filepath: sourcePath,
    });
    assert.equal(
      await prettier.format(formatted, { ...options, filepath: sourcePath }),
      formatted,
    );
    checks.push("prettier: project configuration and format idempotence");
    const manifestPath = require.resolve("prettier/package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const cli = join(dirname(manifestPath), manifest.bin);
    const args = [
      "--config",
      ".prettierrc.json",
      "--ignore-path",
      ".prettierignore",
    ];
    const commands = [run(cli, [...args, "--check", "format"], directory, 1)];
    checks.push("prettier: CLI check reports unformatted source");
    commands.push(run(cli, [...args, "--write", "format"], directory, 0));
    commands.push(run(cli, [...args, "--check", "format"], directory, 0));
    assert.equal(
      await readFile(join(directory, "format", "ignored.ts"), "utf8"),
      "This file deliberately is not TypeScript.\n",
    );
    checks.push("prettier: CLI write and check respect ignored input");
    return {
      productId: "configuration",
      verifiedOn: new Date().toISOString(),
      packages,
      products: [
        { productId: "semver", version: packages.semver, examplesExecuted: 2 },
        { productId: "yaml", version: packages.yaml, examplesExecuted: 3 },
        {
          productId: "smol-toml",
          version: packages["smol-toml"],
          examplesExecuted: 3,
        },
        {
          productId: "prettier",
          version: packages.prettier,
          examplesExecuted: 3,
        },
      ],
      examplesExecuted: checks.length,
      checks,
      commands,
      environment: `Node ${process.versions.node}; parser APIs and Prettier CLI`,
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
