import { spawnSync } from "node:child_process";
import { isOpenCodeInventory } from "../adapters/opencode-doctor.js";
import { nativeJsonRunner } from "../diagnostics/native-json.js";
import type { Runner } from "./types.js";
export const spawnRunner: Runner = (command, args, cwd, env) => {
  if (isOpenCodeInventory(command, args))
    return nativeJsonRunner(command, args, cwd, env);
  const result = spawnSync(command, [...args], {
    cwd,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 1 << 26,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    missing: code === "ENOENT",
    status: result.status,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};
