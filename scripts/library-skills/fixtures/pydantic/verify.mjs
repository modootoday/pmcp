import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function verify({ scratchRoot, pythonExecutable }) {
  assert.ok(scratchRoot, "Pass an isolated evidence workspace");
  assert.ok(pythonExecutable, "Pass an explicitly selected Python environment");
  const root = resolve(scratchRoot);
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "pydantic-"));
  await cp(new URL("./project/", import.meta.url), directory, {
    recursive: true,
  });
  const result = spawnSync(
    pythonExecutable,
    ["-B", join(directory, "verify.py")],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PYTHONNOUSERSITE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
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
    pythonExecutable: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
