import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function verify({ scratchRoot, goExecutable, goModCache }) {
  assert.ok(scratchRoot, "Pass an isolated evidence workspace");
  assert.ok(goExecutable, "Pass an explicitly selected Go executable");
  const root = resolve(scratchRoot);
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "google-uuid-"));
  await cp(new URL("./project/", import.meta.url), directory, {
    recursive: true,
  });
  const env = {
    ...process.env,
    GOTOOLCHAIN: "local",
    GOWORK: "off",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOMAXPROCS: "1",
    GOCACHE: join(directory, "build-cache"),
  };
  if (goModCache) env.GOMODCACHE = goModCache;
  const result = spawnSync(
    goExecutable,
    ["run", "-mod=readonly", "-p=1", "."],
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
    goExecutable: process.argv[3],
    goModCache: process.argv[4],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
