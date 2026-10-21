import { safeEndpoint } from "../../mcp-auth/endpoint.js";
import { fail } from "./_shared.js";
import type { Table } from "./types.js";

export function readTransport(path: string, where: string, entry: Table) {
  const command = entry["command"];
  const url = entry["url"];
  const auth = entry["auth"];
  if (auth !== undefined && auth !== "native" && auth !== "pmcp")
    fail(path, where, "auth must be native or pmcp");
  if (auth === "pmcp" && typeof url !== "string")
    fail(path, where, "auth = pmcp requires a remote HTTP server");
  if (auth === "pmcp" && typeof url === "string") safeEndpoint(url);
  if ((command === undefined) === (url === undefined)) {
    fail(path, where, "provide exactly one of command or url");
  }
  for (const [key, item] of [
    ["command", command],
    ["url", url],
    ["cwd", entry["cwd"]],
  ] as const) {
    if (item !== undefined && (typeof item !== "string" || item === "")) {
      fail(path, where, `${key} must be a nonempty string`);
    }
  }
  if (typeof url === "string") {
    let endpoint: URL;
    try {
      endpoint = new URL(url);
    } catch {
      fail(path, where, "url must be an absolute HTTP(S) endpoint");
    }
    if (
      !["https:", "http:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      fail(path, where, "url must use HTTP(S) without embedded credentials");
    }
    for (const key of [
      "args",
      "env",
      "env_vars",
      "env_from",
      "cwd",
      "mailbox",
    ]) {
      if (entry[key] !== undefined) {
        fail(path, where, `${key} applies only to stdio`);
      }
    }
  } else {
    for (const key of ["headers", "header_env", "bearer_token_env_var"]) {
      if (entry[key] !== undefined) {
        fail(path, where, `${key} applies only to HTTP`);
      }
    }
  }

  return { command, url, auth };
}
