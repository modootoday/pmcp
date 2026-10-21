import { ProjectError } from "../package-rules.js";
import { type Tool } from "../spec.js";
import type { Table } from "./types.js";
import { object } from "./_shared.js";
export function httpCandidate(tool: Tool, entry: Table): Table {
  if (tool === "gemini" && entry["url"] !== undefined) {
    throw new ProjectError(
      "Gemini url entries use SSE; use a Streamable HTTP source",
    );
  }
  const url = entry["httpUrl"] ?? entry["url"] ?? entry["serverUrl"];
  if (typeof url !== "string") {
    throw new ProjectError("MCP source needs command or url");
  }
  const endpoint = new URL(url);
  const loginFlag =
    endpoint.search === "?login" || endpoint.search === "?login=";
  if (
    (endpoint.search && !loginFlag) ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new ProjectError(
      "URLs with query values, fragment or embedded credentials require review before import",
    );
  }
  const result: Table = { url };
  const headers: Record<string, string> = {};
  const headerEnv: Record<string, string> = {};
  const sourceHeaders = object(entry["headers"] ?? entry["http_headers"] ?? {});
  for (const [key, value] of Object.entries(sourceHeaders)) {
    if (typeof value !== "string") {
      throw new ProjectError("HTTP header values must be strings");
    }
    const reference = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u);
    const bearer = value.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/iu);
    if (reference) {
      headerEnv[key] = reference[1]!;
    } else if (key.toLowerCase() === "authorization" && bearer) {
      result["bearer_token_env_var"] = bearer[1];
    } else if (/authorization|cookie|token|secret|api[-_]?key/iu.test(key)) {
      throw new ProjectError(
        "Credential headers require environment references before import",
      );
    } else {
      headers[key] = value;
    }
  }
  for (const [key, value] of Object.entries(
    object(entry["env_http_headers"] ?? {}),
  )) {
    if (typeof value !== "string") {
      throw new ProjectError("Environment header references must be strings");
    }
    headerEnv[key] = value;
  }
  if (Object.keys(headers).length > 0) {
    result["headers"] = headers;
  }
  if (Object.keys(headerEnv).length > 0) {
    result["header_env"] = headerEnv;
  }
  if (entry["bearer_token_env_var"] !== undefined) {
    result["bearer_token_env_var"] = entry["bearer_token_env_var"];
  }
  return result;
}
