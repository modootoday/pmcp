import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parse } from "smol-toml";
import { ProjectError } from "../package-rules.js";
import { TOOLS, type Tool } from "../spec.js";
import type { Table } from "./types.js";
import { object } from "./_shared.js";
export function sourceServers(
  source: string,
  root: string,
): {
  tool: Tool;
  path: string;
  servers: Table;
  sha256: string;
} {
  const split = source.indexOf(":");
  const tool = source.slice(0, split);
  if (
    split < 1 ||
    !(TOOLS as readonly string[]).includes(tool) ||
    source.slice(split + 1) === ""
  ) {
    throw new ProjectError(
      "Use --source <claude|codex|gemini|grok|antigravity>:<file>",
    );
  }
  const path = resolve(root, source.slice(split + 1));
  if (tool === "opencode") {
    throw new ProjectError(
      "OpenCode MCP import is not qualified; define the server in pmcp.toml",
    );
  }
  if (statSync(path).size > 2 * 1024 * 1024) {
    throw new ProjectError("MCP source exceeds the 2 MiB limit");
  }
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const text = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  let parsed: Table;
  try {
    if (text.trim() === "") {
      parsed = {};
    } else if (path.endsWith(".toml")) {
      parsed = parse(text);
    } else {
      parsed = object(JSON.parse(text));
    }
  } catch {
    throw new ProjectError(
      `Cannot parse MCP source for ${tool}; source contents are redacted`,
    );
  }
  const servers = parsed["mcpServers"] ?? parsed["mcp_servers"] ?? {};
  return { tool: tool as Tool, path, servers: object(servers), sha256 };
}
