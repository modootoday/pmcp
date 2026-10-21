import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "smol-toml";
import { readMcp } from "../mcp-spec.js";
import { ProjectError } from "../package-rules.js";
import type { Table } from "./types.js";
import type { McpImportEntry } from "./types.js";
import type { McpImportPlan } from "./types.js";
import { object } from "./_shared.js";
import { equivalent } from "./_shared.js";
import { sourceServers } from "./source.js";
import { candidate } from "./candidate.js";
export function planMcpImport(
  config: string,
  sources: readonly string[],
  names: readonly string[] = [],
): McpImportPlan {
  const original = readFileSync(config, "utf8");
  const root = dirname(resolve(config));
  const existing = object(parse(original)["mcp"] ?? {});
  const additions: Record<string, Table> = {};
  const entries: McpImportEntry[] = [];
  const fingerprints: {
    path: string;
    sha256: string;
  }[] = [];
  const wanted = new Set(names);
  for (const source of sources) {
    const read = sourceServers(source, root);
    fingerprints.push({ path: read.path, sha256: read.sha256 });
    for (const [alias, raw] of Object.entries(read.servers)) {
      if (wanted.size > 0 && !wanted.has(alias)) {
        continue;
      }
      try {
        const proposed = candidate(read.tool, object(raw), read.path, alias);
        readMcp(config, { [alias]: proposed });
        const previous = existing[alias] ?? additions[alias];
        if (previous !== undefined) {
          const status = equivalent(alias, object(previous), proposed)
            ? "unchanged"
            : "conflict";
          entries.push({ alias, source: read.path, status });
          continue;
        }
        additions[alias] = proposed;
        entries.push({ alias, source: read.path, status: "add" });
      } catch (error) {
        const detail =
          error instanceof ProjectError
            ? error.message
            : "Unsupported source configuration; values are redacted";
        entries.push({ alias, source: read.path, status: "blocked", detail });
      }
    }
  }
  for (const name of wanted) {
    if (!entries.some((entry) => entry.alias === name)) {
      entries.push({
        alias: name,
        source: "",
        status: "blocked",
        detail: "Requested server was not found",
      });
    }
  }
  return { entries, additions, original, config, sources: fingerprints };
}
