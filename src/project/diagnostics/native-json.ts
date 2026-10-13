import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Runner } from "../doctor.js";

const MAX_OUTPUT = 1 << 26;

export const nativeJsonRunner: Runner = (command, args, cwd, env) => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-native-json-"));
  let descriptor: number | undefined;
  try {
    const file = join(directory, "stdout.json");
    descriptor = openSync(file, "wx", 0o600);
    // Native CLIs can exit before their piped stdout drains.
    const result = spawnSync(command, [...args], {
      cwd,
      ...(env ? { env: { ...process.env, ...env } } : {}),
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: MAX_OUTPUT,
      stdio: ["ignore", descriptor, "pipe"],
    });
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (result.status !== 0 || result.error) {
      return {
        missing: code === "ENOENT",
        status: result.status,
        stdout:
          result.stderr || result.error?.message || "Native inventory failed",
      };
    }
    if (statSync(file).size > MAX_OUTPUT) {
      return {
        missing: false,
        status: null,
        stdout: "Native JSON output exceeds 64 MiB",
      };
    }
    return { missing: false, status: 0, stdout: readFileSync(file, "utf8") };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
};
