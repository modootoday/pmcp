import type { SyntheticOptions } from "../types.js";

export function synthetic(options: SyntheticOptions): Record<string, unknown> {
  const { cwd, session, event, command, path, tool } = options;
  const defaults: Record<string, string> = {
    shell: "bash",
    edit: "write",
    read: "read",
    other: "unknown_tool",
  };
  let name = tool ? (defaults[tool] ?? tool) : undefined;
  if (!name && command !== undefined) name = "bash";
  if (!name && path !== undefined) name = "write";
  const args =
    name === "bash"
      ? { command: command ?? "" }
      : { filePath: path ?? "", content: "" };
  if (event === "session.created" || event === "session.idle")
    return { type: event, properties: { sessionID: session }, directory: cwd };
  return {
    input: {
      sessionID: session,
      ...(name ? { tool: name, callID: "c1" } : {}),
    },
    ...(name ? { args } : {}),
    directory: cwd,
  };
}
