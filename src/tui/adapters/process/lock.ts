import { spawnSync } from "node:child_process";
import { readView } from "../../state/store.js";
import type { TuiInvocation } from "../../../commands/tui/invocation.js";
import type { Receipt } from "../../../harness/contracts.js";

export function serializedView(invocation: TuiInvocation): Receipt {
  const { file, view } = readView(invocation.viewFile!);
  const args = ["locked", invocation.action, "--view", file];
  for (const [name, value] of [
    ["index", invocation.input.index],
    ["columns", invocation.input.columns],
    ["rows", invocation.input.rows],
    ["confirm-session", invocation.input.confirmSession],
  ] as const)
    if (value !== undefined) args.push(`--${name}`, String(value));
  const child = spawnSync(
    "flock",
    [
      "--wait",
      "10",
      "--close",
      "--conflict-exit-code",
      "73",
      `${file}.lock`,
      view.node,
      view.worker,
      ...args,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (child.status === 73) throw new Error("view_action_busy");
  if (child.error)
    throw new Error("view_action_interrupted", { cause: child.error });
  if (!child.stdout.trim()) throw new Error("view_action_interrupted");
  return JSON.parse(child.stdout) as Receipt;
}
