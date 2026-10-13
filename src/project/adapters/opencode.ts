import { existsSync } from "node:fs";
import { join } from "node:path";

import type { LaunchSpec } from "../mcp.js";
import { ProjectError } from "../package-rules.js";
import type { McpServerSpec } from "../spec.js";

export const OPENCODE_CONFIG = "opencode.json";

export function checkOpenCodeConfig(root: string): void {
  if (existsSync(join(root, "opencode.jsonc"))) {
    throw new ProjectError(
      "OpenCode JSONC projection is not supported; reconcile opencode.jsonc before projecting opencode.json",
    );
  }
}

export function opencodeMcpEntry(
  server: McpServerSpec,
  started?: LaunchSpec,
): Record<string, unknown> {
  if (server.tools !== undefined) {
    throw new ProjectError(
      "OpenCode per-server tool filtering is not qualified; limit this server's targets",
    );
  }
  const timeout = server.native?.opencode;
  if (server.url !== undefined) {
    const headers = { ...server.headers };
    for (const [key, name] of Object.entries(server.headerEnv ?? {})) {
      headers[key] = `{env:${name}}`;
    }
    if (server.bearerTokenEnvVar) {
      headers["Authorization"] = `Bearer {env:${server.bearerTokenEnvVar}}`;
    }
    return {
      type: "remote",
      url: server.url,
      enabled: true,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...timeout,
    };
  }
  if (!started) {
    throw new ProjectError(
      "OpenCode local MCP projection requires a launch specification",
    );
  }
  return {
    type: "local",
    command: [started.command, ...started.args],
    enabled: true,
    ...(Object.keys(started.env).length > 0
      ? { environment: { ...started.env } }
      : {}),
    ...timeout,
  };
}
