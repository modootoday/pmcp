import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { parse, stringify } from "smol-toml";
import { backupFiles } from "../backup.js";
import { ProjectError } from "../package-rules.js";
import type { McpImportPlan } from "./types.js";
export function writeMcpImport(plan: McpImportPlan): string {
  if (
    plan.entries.some(
      (entry) => entry.status === "blocked" || entry.status === "conflict",
    )
  ) {
    throw new ProjectError(
      "Resolve blocked or conflicting MCP entries before importing",
    );
  }
  if (readFileSync(plan.config, "utf8") !== plan.original) {
    throw new ProjectError("pmcp.toml changed after planning; plan again");
  }
  for (const source of plan.sources) {
    const current = createHash("sha256")
      .update(readFileSync(source.path))
      .digest("hex");
    if (current !== source.sha256) {
      throw new ProjectError("MCP source changed after planning; plan again");
    }
  }
  const additions = stringify({ mcp: plan.additions } as Parameters<
    typeof stringify
  >[0]);
  const after = `${plan.original.trimEnd()}\n\n${additions}`;
  parse(after);
  const backup = backupFiles(dirname(resolve(plan.config)), [
    basename(plan.config),
  ]);
  writeFileSync(plan.config, after);
  return backup;
}
