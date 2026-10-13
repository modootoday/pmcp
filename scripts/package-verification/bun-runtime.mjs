import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);

export function bunExecutable() {
  const executable = execFileSync("bun", [file, "--native-executable"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4096,
  }).trim();
  assert.ok(isAbsolute(executable) && !/[\r\n]/u.test(executable));
  accessSync(executable, constants.X_OK);
  return executable;
}

if (process.argv[1] === file && process.argv[2] === "--native-executable") {
  assert.ok(process.versions.bun, "Run the executable probe with Bun");
  console.log(process.execPath);
}
