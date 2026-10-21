import { blockOutput, jsonOutput, MARK, type Output } from "../outputs.js";
import type { McpServerSpec, ProjectSpec, Tool } from "../spec.js";
import { OPENCODE_CONFIG, checkOpenCodeConfig } from "../adapters/opencode.js";
import { ANTIGRAVITY_MCP_PLUGIN } from "./_shared.js";
import { nativeEntry } from "./native.js";

const tomlValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    const parts = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`,
    );
    return `{ ${parts.join(", ")} }`;
  }
  return JSON.stringify(value);
};

export function serversForTool(
  spec: ProjectSpec,
  tool: Tool,
): Array<[string, McpServerSpec]> {
  return Object.entries(spec.mcp).filter(
    ([, server]) =>
      server.targets === undefined || server.targets.includes(tool),
  );
}

function tomlServers(
  spec: ProjectSpec,
  servers: ReadonlyArray<[string, McpServerSpec]>,
  tool: Tool,
): string {
  const lines = [`# ${MARK} from pmcp.toml [mcp]`];
  for (const [alias, server] of servers) {
    lines.push("", `[mcp_servers.${alias}]`);
    for (const [key, value] of Object.entries(
      nativeEntry(spec, alias, server, tool),
    )) {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function mcpOutputs(spec: ProjectSpec): Output[] {
  const outputs: Output[] = [];
  const jsonFiles: Partial<Record<Tool, string>> = {
    claude: ".mcp.json",
    gemini: ".gemini/settings.json",
    antigravity: `${ANTIGRAVITY_MCP_PLUGIN}/mcp_config.json`,
    opencode: OPENCODE_CONFIG,
  };
  for (const tool of spec.tools) {
    if (tool === "opencode") checkOpenCodeConfig(spec.root);
    const servers = serversForTool(spec, tool);
    if (servers.length === 0) {
      continue;
    }
    if (tool === "antigravity") {
      outputs.push({
        kind: "file",
        path: `${ANTIGRAVITY_MCP_PLUGIN}/plugin.json`,
        content: `${JSON.stringify({ name: "pmcp-mcp" }, null, 2)}\n`,
      });
    }
    const file = jsonFiles[tool];
    if (file) {
      for (const [alias, server] of servers) {
        outputs.push(
          jsonOutput(
            file,
            [tool === "opencode" ? "mcp" : "mcpServers", alias],
            nativeEntry(spec, alias, server, tool),
          ),
        );
      }
      continue;
    }
    outputs.push(
      blockOutput(`.${tool}/config.toml`, tomlServers(spec, servers, tool)),
    );
  }
  return outputs;
}
