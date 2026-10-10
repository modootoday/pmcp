import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout,
  };
}

export async function verify({ scratchRoot }) {
  const dependencyRequire = createRequire(
    join(resolve(scratchRoot), "package.json"),
  );
  const packagePaths = Object.fromEntries(
    ["tsup", "typescript", "@types/node"].map((name) => [
      name,
      dependencyRequire.resolve(`${name}/package.json`),
    ]),
  );
  const packages = {};
  for (const [name, path] of Object.entries(packagePaths)) {
    packages[name] = JSON.parse(await readFile(path, "utf8")).version;
  }

  const workRoot = await mkdtemp(join(resolve(scratchRoot), "tsup-"));
  const libraryRoot = join(workRoot, "library");
  const consumerRoot = join(workRoot, "consumer");
  await mkdir(libraryRoot, { recursive: true });
  await mkdir(consumerRoot, { recursive: true });
  for (const file of [
    "package.json",
    "tsconfig.json",
    "tsup.config.ts",
    "src",
  ]) {
    await cp(join(fixtureRoot, file), join(libraryRoot, file), {
      recursive: true,
    });
  }
  await symlink(
    join(resolve(scratchRoot), "node_modules"),
    join(libraryRoot, "node_modules"),
    "dir",
  );
  const tsupManifest = JSON.parse(await readFile(packagePaths.tsup, "utf8"));
  const tsupBin = join(dirname(packagePaths.tsup), tsupManifest.bin.tsup);
  const tscBin = join(dirname(packagePaths.typescript), "bin/tsc");
  const commands = [run(process.execPath, [tsupBin], libraryRoot)];

  for (const file of ["index.js", "index.cjs", "index.d.ts", "index.d.cts"]) {
    const content = await readFile(join(libraryRoot, "dist", file), "utf8");
    assert.ok(content.length > 0);
  }
  for (const file of ["index.js", "index.cjs"]) {
    assert.match(
      await readFile(join(libraryRoot, "dist", file), "utf8"),
      /(?:from\s+["'](?:node:)?crypto["']|require\(["'](?:node:)?crypto["']\))/,
    );
  }

  const packed = run(
    "npm",
    ["pack", "--ignore-scripts", "--json"],
    libraryRoot,
  );
  commands.push(packed);
  const pack = JSON.parse(packed.stdout)[0];
  assert.ok(pack.files.some((file) => file.path === "dist/index.d.cts"));
  assert.ok(!pack.files.some((file) => file.path.startsWith("src/")));
  const installedRoot = join(
    consumerRoot,
    "node_modules",
    "pmcp-tsup-fixture-library",
  );
  await mkdir(installedRoot, { recursive: true });
  commands.push(
    run(
      "tar",
      [
        "-xzf",
        join(libraryRoot, pack.filename),
        "--strip-components=1",
        "-C",
        installedRoot,
      ],
      consumerRoot,
    ),
  );
  const typeRoot = join(consumerRoot, "node_modules", "@types");
  await symlink(dirname(dirname(packagePaths["@types/node"])), typeRoot, "dir");
  for (const file of ["consumer.mts", "consumer.cts"]) {
    await cp(join(fixtureRoot, file), join(consumerRoot, file));
  }
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  commands.push(
    run(
      process.execPath,
      [
        tscBin,
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--outDir",
        "dist",
        "consumer.mts",
        "consumer.cts",
      ],
      consumerRoot,
    ),
  );
  commands.push(run(process.execPath, ["dist/consumer.mjs"], consumerRoot));
  commands.push(run(process.execPath, ["dist/consumer.cjs"], consumerRoot));

  const sources = {};
  for (const file of [
    "package.json",
    "tsconfig.json",
    "tsup.config.ts",
    "verify.mjs",
    "src/index.ts",
    "consumer.mts",
    "consumer.cts",
  ]) {
    sources[file] = createHash("sha256")
      .update(await readFile(join(fixtureRoot, file)))
      .digest("hex");
  }
  return {
    productId: "tsup",
    packages,
    examplesExecuted: 6,
    checks: [
      "dual-format build",
      "declaration files",
      "builtin externalization",
      "tarball contents",
      "packed consumer typecheck",
      "ESM and CJS consumer execution",
    ],
    commands,
    sources,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const scratchRoot = process.argv[2];
  if (!scratchRoot)
    throw new Error("Pass an isolated dependency workspace path");
  console.log(JSON.stringify(await verify({ scratchRoot })));
}
