import type { McpServerSpec, Tool } from "../spec.js";
import { ProjectError } from "../package-rules.js";

export function httpEntry(
  server: McpServerSpec,
  tool: Tool,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (tool === "gemini") {
    result["httpUrl"] = server.url;
  } else if (tool === "antigravity") {
    result["serverUrl"] = server.url;
  } else {
    result["url"] = server.url;
  }
  if (tool === "claude") {
    result["type"] = "http";
  }
  const headers = { ...server.headers };
  if (
    tool === "antigravity" &&
    (Object.keys(headers).length > 0 ||
      Object.keys(server.headerEnv ?? {}).length > 0 ||
      server.bearerTokenEnvVar !== undefined)
  ) {
    throw new ProjectError(
      "Antigravity HTTP header projection is not qualified; limit this server's targets",
    );
  }
  if (tool === "codex") {
    if (Object.keys(headers).length > 0) {
      result["http_headers"] = headers;
    }
    if (Object.keys(server.headerEnv ?? {}).length > 0) {
      result["env_http_headers"] = { ...server.headerEnv };
    }
    if (server.bearerTokenEnvVar) {
      result["bearer_token_env_var"] = server.bearerTokenEnvVar;
    }
    return result;
  }
  for (const [key, name] of Object.entries(server.headerEnv ?? {})) {
    headers[key] = `\${${name}}`;
  }
  if (server.bearerTokenEnvVar) {
    headers["Authorization"] = `Bearer \${${server.bearerTokenEnvVar}}`;
  }
  if (Object.keys(headers).length > 0) {
    result["headers"] = headers;
  }
  return result;
}
