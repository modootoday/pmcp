import type { McpServerSpec, ProjectSpec, Tool } from "../spec.js";
import type { Runtime } from "../../runtime.js";
import { ProjectError } from "../package-rules.js";
import { opencodeMcpEntry } from "../adapters/opencode.js";
import { relative, isAbsolute } from "node:path";
import { launch, forwardedVariables } from "./launch.js";
import { ROOT_VAR } from "./_shared.js";
import type { LaunchSpec } from "./types.js";
import { httpEntry } from "./http.js";
import { proxyDriver } from "./driver.js";

const runtimeByTool: Readonly<Partial<Record<Tool, Runtime>>> = {
  claude: "claude-code",
  codex: "codex-cli",
  gemini: "gemini-cli",
  grok: "grok-cli",
  antigravity: "antigravity",
};

function mailboxRuntime(tool: Tool): Runtime {
  const runtime = runtimeByTool[tool];
  if (!runtime) {
    throw new ProjectError(
      "OpenCode mailbox runtime binding is not qualified; limit this server's targets",
    );
  }
  return runtime;
}
// Runtimes whose stdio MCP entry can start the exec-mcp proxy with the inherited environment.
const PMCP_AUTH_TOOLS: readonly Tool[] = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "grok",
  "opencode",
];

export function nativeEntry(
  spec: ProjectSpec,
  alias: string,
  server: McpServerSpec,
  tool: Tool,
): Record<string, unknown> {
  let result: Record<string, unknown>;
  if (server.auth === "pmcp") {
    if (!PMCP_AUTH_TOOLS.includes(tool))
      throw new ProjectError(
        `pmcp MCP authentication currently supports ${PMCP_AUTH_TOOLS.join(", ")} targets`,
      );
    const started = proxyDriver(spec, alias);
    // The proxy owns the remote URL, so opencode gets a local entry that starts it.
    if (tool === "opencode") {
      const { url: _remote, ...local } = server;
      return opencodeMcpEntry(local, started);
    }
    result = { command: started.command, args: [...started.args] };
    if (Object.keys(started.env).length) result["env"] = started.env;
    if (tool === "codex")
      result["env_vars"] = [
        "XDG_STATE_HOME",
        ...Object.values(server.headerEnv ?? {}),
      ];
  } else if (server.url !== undefined) {
    if (tool === "opencode") return opencodeMcpEntry(server);
    result = httpEntry(server, tool);
  } else {
    const env = { ...server.env };
    if (server.mailbox) {
      env["PMCP_MAILBOX_RUNTIME"] = mailboxRuntime(tool);
    }
    let started: LaunchSpec;
    if (Object.keys(server.envFrom ?? {}).length > 0) {
      const entry = relative(spec.root, process.argv[1] ?? "");
      const driverEnv: Record<string, string> = {};
      if (server.mailbox) {
        driverEnv["PMCP_MAILBOX_RUNTIME"] = mailboxRuntime(tool);
      }
      if (!isAbsolute(entry) && !entry.startsWith("..")) {
        started = launch({
          command: "node",
          args: [`${ROOT_VAR}/${entry}`, "project", "exec-mcp", alias],
          env: driverEnv,
        });
      } else {
        started = launch({
          command: "pmcp",
          args: ["project", "exec-mcp", alias],
          env: driverEnv,
        });
      }
    } else {
      started = launch({ ...server, env });
    }
    if (tool === "opencode") return opencodeMcpEntry(server, started);
    result = { command: started.command, args: [...started.args] };
    if (Object.keys(started.env).length > 0) {
      result["env"] = { ...started.env };
    }
    const variables = forwardedVariables(server).filter(
      (key) => !Object.hasOwn(server.envFrom ?? {}, key),
    );
    if (tool === "codex" && variables.length > 0) {
      result["env_vars"] = variables;
    }
  }
  if (server.tools) {
    if (tool === "gemini") {
      result["includeTools"] = [...server.tools];
    }
    if (tool === "codex") {
      result["enabled_tools"] = [...server.tools];
    }
  }
  return { ...result, ...server.native?.[tool] };
}
