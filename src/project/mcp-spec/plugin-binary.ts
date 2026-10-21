import { packagedBinary } from "../../native/binary.js";
import type { Finding } from "../doctor/types.js";
import type { McpServerSpec } from "../spec.js";

// Shipped in the Linux platform package but not linked onto PATH: npm links only the main
// package's bin. A bare name in [mcp.<alias>] command resolves here, so pmcp.toml names no path.
export const PLUGIN_BINARIES = ["pmcp-browser", "pmcp-desktop"] as const;

const isPlugin = (command: string) =>
  (PLUGIN_BINARIES as readonly string[]).includes(command);

// The installed binary for a bare plugin name; anything else, including an explicit absolute
// path, is kept. An unresolved bare name stays bare and doctor says why.
export function resolvePluginCommand(command: string, from?: string): string {
  if (!isPlugin(command)) return command;
  const found = packagedBinary(command, from);
  return "path" in found ? found.path : command;
}

export function pluginBinaryDoctor(
  servers: Readonly<Record<string, McpServerSpec>>,
  from?: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const [alias, server] of Object.entries(servers)) {
    const command = server.command;
    if (command === undefined) continue;
    const name = command.split("/").pop()!;
    if (!isPlugin(name)) continue;
    const check = `[mcp.${alias}] ${name}`;
    const found = packagedBinary(name, from);
    if (isPlugin(command))
      findings.push({
        tool: "project",
        check,
        status: "warn",
        detail: `not resolved: ${"reason" in found ? found.reason : "unknown"}; runs ${name} from PATH`,
      });
    else
      findings.push({
        tool: "project",
        check,
        status: "ok",
        detail:
          "path" in found && found.path === command
            ? `resolved to ${command} (platform package)`
            : `explicit command kept: ${command}`,
      });
  }
  return findings;
}
