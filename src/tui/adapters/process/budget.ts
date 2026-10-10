import { readFileSync } from "node:fs";
import { command } from "../../../harness/adapters/process/command.js";

export function viewUnit(owner: string): string {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner))
    throw new Error("invalid_view_owner");
  return `pmcp-tui-${owner}.scope`;
}

export function startPresentation(
  owner: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): string {
  return command(
    "systemd-run",
    [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${viewUnit(owner)}`,
      "-p",
      "MemoryMax=512M",
      "-p",
      "TasksMax=128",
      "-p",
      "CPUQuota=100%",
      "tmux",
      ...args,
    ],
    { env },
  );
}

export function assertPresentationBudget(owner: string, pid: number): void {
  if (
    !readFileSync(`/proc/${pid}/cgroup`, "utf8").includes(
      `/${viewUnit(owner)}\n`,
    )
  )
    throw new Error("foreign_view_budget");
}
