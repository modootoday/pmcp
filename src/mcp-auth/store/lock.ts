import { spawn } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { credentialPath, privateDirectory } from "./files.js";
import { flockAvailable, lockFileAsync } from "../../locks/file-lock.js";
import { McpAuthError } from "../_shared.js";
import type { Environment } from "../types.js";

export async function withCredentialLock<T>(
  name: string,
  env: Environment,
  action: () => Promise<T>,
): Promise<T> {
  privateDirectory(env);
  const path = `${credentialPath(name, env)}.lock`;
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  closeSync(fd);
  if (!flockAvailable()) {
    const held = await lockFileAsync(path, 30_000);
    if (!held) throw new McpAuthError("MCP credential lock timed out");
    try {
      return await action();
    } finally {
      held.release();
    }
  }
  const holder = spawn(
    "flock",
    [
      "--exclusive",
      "--timeout",
      "30",
      path,
      process.execPath,
      "-e",
      'process.stdout.write("locked\\n");\nprocess.stdin.resume();',
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const exited = new Promise<void>((resolve) =>
    holder.once("close", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      holder.once("error", () =>
        reject(
          new McpAuthError(
            "Cannot acquire MCP credential lock; flock is required",
          ),
        ),
      );
      holder.once("exit", () =>
        reject(new McpAuthError("MCP credential lock timed out")),
      );
      holder.stdout.once("data", () => resolve());
    });
    return await action();
  } finally {
    holder.stdin.end();
    await exited;
  }
}
