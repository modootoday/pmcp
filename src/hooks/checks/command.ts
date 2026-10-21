import { spawnSync } from "node:child_process";

export function runCheck(
  command: readonly string[],
  root: string,
  timeout: number,
): boolean {
  if (timeout <= 0) return false;
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    stdio: "ignore",
    timeout,
    killSignal: "SIGKILL",
    shell: false,
  });
  return !result.error && result.status === 0;
}
