import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkTypes(
  require,
  directory,
  name,
  files,
  options = {},
  expectedCodes = [],
) {
  const config = join(directory, `${name}.json`);
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        ...options,
      },
      files,
    }),
  );
  const result = spawnSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", config, "--pretty", "false"],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  if (!expectedCodes.length) {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return;
  }
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const codes = [...result.stdout.matchAll(/error TS(\d+):/gu)]
    .map((match) => Number(match[1]))
    .sort();
  assert.deepEqual(codes, [...expectedCodes].sort(), result.stdout);
}
