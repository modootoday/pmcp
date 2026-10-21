import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "run_command",
    edit: "write_to_file",
    read: "view_file",
    other: "unknown_tool",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "run_command";
  if (!name && path !== undefined) name = "write_to_file";
  const args =
    name === "run_command"
      ? { CommandLine: command ?? "", Cwd: cwd }
      : { TargetFile: path ?? "", CodeContent: "" };
  return {
    conversationId: session,
    workspacePaths: [cwd],
    ...(event === "PreInvocation"
      ? { invocationNum: 0, initialNumSteps: 1 }
      : {}),
    ...(event === "Stop" ? { executionNum: 0 } : {}),
    ...(name ? { toolCall: { name, args } } : {}),
  };
}
