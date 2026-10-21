import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { ArgumentError, type CommandContext } from "../../cli/command.js";
import {
  defaultPtySocket,
  ptyRequest,
} from "../../harness/adapters/pty/client.js";
import {
  PTY_SERVER_NAME,
  registerPtyTools,
  type PtyCall,
} from "../../harness/adapters/pty/mcp.js";

const PTY_SERVER_VERSION = "0.1.0";

// The operator's policy, as the daemon reports it, decides once whether write tools exist;
// the daemon checks it again on every call, so a later edit narrows what the tools can do.
async function mcpWrite(call: PtyCall): Promise<boolean> {
  try {
    const reply = await call({ op: "describe", via: "mcp" }, 10_000);
    const policy = (reply["policy"] ?? {}) as Record<string, unknown>;
    return policy["mcp_write"] === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pmcp harness mcp: describe failed: ${message}\n`);
    return false;
  }
}

// A stdio server of its own, separate from the pmcp catalog server and never on a network
// transport; it only talks to one pmcp-pty socket, named by the environment so the pinned
// 0.17.4 help surface stays as it is.
export async function runPtyMcp(context: CommandContext): Promise<number> {
  const extra = [
    ...context.args.positional.slice(1),
    ...context.args.options.keys(),
    ...context.args.flags,
  ];
  if (extra.length > 0) throw new ArgumentError("Provide only mcp");
  const socket = defaultPtySocket(context.env);
  if (!socket)
    throw new ArgumentError("Set PMCP_PTY_SOCKET or XDG_RUNTIME_DIR");
  const call: PtyCall = (request, limitMs) =>
    ptyRequest(socket, request, limitMs);
  const write = await mcpWrite(call);
  serveStdio(
    () => {
      const server = new McpServer({
        name: PTY_SERVER_NAME,
        version: PTY_SERVER_VERSION,
      });
      registerPtyTools(server, call, write);
      return server;
    },
    {
      // Diagnostics stay on stderr because stdout carries the MCP protocol.
      onerror: (error) =>
        process.stderr.write(`pmcp harness mcp: ${error.message}\n`),
    },
  );
  return 0;
}
