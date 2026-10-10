import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function lockedVersion(source, name) {
  const packageBlock = source
    .split("[[package]]")
    .find((block) => block.includes(`\nname = "${name}"\n`));
  assert.ok(packageBlock, `Missing locked dependency ${name}`);
  return packageBlock.match(/\nversion = "([^"]+)"/u)?.[1];
}

export async function verify({
  scratchRoot,
  cargoExecutable,
  cargoLockPath,
  cargoHome,
}) {
  assert.ok(scratchRoot, "Pass an isolated evidence workspace");
  assert.ok(cargoExecutable, "Pass an explicitly selected Cargo executable");
  assert.ok(
    cargoLockPath,
    "Prepare the fixture Cargo.lock before offline verification",
  );
  const root = resolve(scratchRoot);
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "serde-json-"));
  await cp(new URL("./project/", import.meta.url), directory, {
    recursive: true,
  });
  await cp(cargoLockPath, join(directory, "Cargo.lock"));
  const source = await readFile(join(directory, "Cargo.lock"), "utf8");
  const packages = {
    serde: lockedVersion(source, "serde"),
    serde_json: lockedVersion(source, "serde_json"),
  };
  assert.deepEqual(packages, { serde: "1.0.228", serde_json: "1.0.149" });
  const env = {
    ...process.env,
    CARGO_NET_OFFLINE: "true",
    CARGO_BUILD_JOBS: "1",
    CARGO_TARGET_DIR: join(directory, "target"),
  };
  if (cargoHome) env.CARGO_HOME = cargoHome;
  const result = spawnSync(
    cargoExecutable,
    [
      "run",
      "--locked",
      "--offline",
      "--quiet",
      "--jobs",
      "1",
      "--manifest-path",
      join(directory, "Cargo.toml"),
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
      env,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    ...JSON.parse(result.stdout),
    packages,
    verifiedOn: new Date().toISOString().slice(0, 10),
    evidenceDirectory: directory,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verify({
    scratchRoot: process.argv[2],
    cargoExecutable: process.argv[3],
    cargoLockPath: process.argv[4],
    cargoHome: process.argv[5],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
