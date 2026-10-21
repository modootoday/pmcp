import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANTIGRAVITY_MCP_PLUGIN, serversForTool } from "../mcp.js";
import { splitFrontmatter } from "../frontmatter.js";
import { agentNames } from "../plan.js";
import type { ProjectSpec } from "../spec.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import { listed } from "./_shared.js";
export function antigravity(
  spec: ProjectSpec,
  options: DoctorOptions,
): Finding[] {
  const foreign = agentNames(spec.root).filter((name) => {
    const text = readFileSync(
      join(spec.root, ".agents/agents", name, "agent.md"),
      "utf8",
    );
    return splitFrontmatter(text).meta["tools"] !== undefined;
  });
  const findings: Finding[] = [
    foreign.length === 0
      ? {
          tool: "antigravity",
          check: "agents carry no tool lists",
          status: "ok",
        }
      : {
          tool: "antigravity",
          check: "agents carry no tool lists",
          status: "fail",
          detail: `move tools to pmcp.toml [agents.<name>.<tool>]: ${foreign.join(", ")}`,
        },
  ];
  if (serversForTool(spec, "antigravity").length > 0) {
    const result = options.run(
      "agy",
      ["plugin", "validate", join(spec.root, ANTIGRAVITY_MCP_PLUGIN)],
      spec.root,
    );
    findings.push(
      listed("antigravity", "project MCP plugin valid", result, [], () => true),
    );
  }
  return findings;
}
