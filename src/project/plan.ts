/**
 * Every output the sources imply, read from disk but written nowhere. Sources:
 * .agents/skills, .agents/agents, .agents/rules, package rule files, and pmcp.toml.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { renderFrontmatter, splitFrontmatter } from "./frontmatter.js";
import { mcpOutputs } from "./mcp.js";
import { hookOutputs } from "./hooks.js";
import { jsonOutput, MARK, type Output } from "./outputs.js";
import { packageRuleOutputs, RULES_DIR } from "./package-rules.js";
import type { ProjectSpec, Tool } from "./spec.js";

/** Fields each tool keeps when an agent is copied; Gemini rejects the others. */
const AGENT_FIELDS: Partial<Record<Tool, readonly string[]>> = {
  claude: ["name", "description", "tools", "model", "effort"],
  gemini: ["name", "description"],
};

export const SETTINGS = ".claude/settings.json";

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

const tomlString = (value: unknown) =>
  JSON.stringify(typeof value === "string" ? value : String(value ?? ""));

export function skillNames(root: string): string[] {
  const dir = join(root, ".agents/skills");
  return listDirs(dir).filter((name) =>
    existsSync(join(dir, name, "SKILL.md")),
  );
}

export function agentNames(root: string): string[] {
  const dir = join(root, ".agents/agents");
  return listDirs(dir).filter((name) =>
    existsSync(join(dir, name, "agent.md")),
  );
}

function skillOutputs(spec: ProjectSpec): Output[] {
  const outputs: Output[] = [];
  for (const name of skillNames(spec.root)) {
    const target = `../../.agents/skills/${name}`;
    if (spec.tools.has("claude")) {
      outputs.push({ kind: "link", path: `.claude/skills/${name}`, target });
    }
    if (spec.tools.has("grok")) {
      outputs.push({ kind: "link", path: `.grok/skills/${name}`, target });
    }
    if (spec.skills[name]?.invocation !== "user") continue;
    if (spec.tools.has("claude")) {
      outputs.push(
        jsonOutput(SETTINGS, ["skillOverrides", name], "user-invocable-only"),
      );
    }
    if (spec.tools.has("codex")) {
      outputs.push({
        kind: "file",
        path: `.agents/skills/${name}/agents/openai.yaml`,
        content: `# ${MARK}\npolicy:\n  allow_implicit_invocation: false\n`,
      });
    }
  }
  return outputs;
}

/** Rules keep Antigravity's form (trigger, globs); Claude gets paths: one level down. */
function ruleOutputs(spec: ProjectSpec): Output[] {
  if (!spec.tools.has("claude")) return [];
  const dir = join(spec.root, ".agents/rules");
  if (!existsSync(dir)) return [];
  const outputs: Output[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const rel = `.agents/rules/${file}`;
    const { meta, body } = splitFrontmatter(
      readFileSync(join(spec.root, rel), "utf8"),
    );
    const globs = [meta["globs"] ?? []]
      .flat()
      .filter((g): g is string => typeof g === "string" && g !== "");
    const head = globs.length > 0 ? renderFrontmatter({ paths: globs }) : "";
    outputs.push({
      kind: "file",
      path: `${RULES_DIR}/pmcp/${file}`,
      content: `${head}\n<!-- ${MARK} from ${rel} -->\n${body}`,
    });
  }
  return outputs;
}

function agentOutputs(spec: ProjectSpec): Output[] {
  const outputs: Output[] = [];
  for (const name of agentNames(spec.root)) {
    const rel = `.agents/agents/${name}/agent.md`;
    const { meta, body } = splitFrontmatter(
      readFileSync(join(spec.root, rel), "utf8"),
    );
    const overrides = spec.agents[name] ?? {};
    const note = `<!-- ${MARK} from ${rel} -->\n`;
    const pick = (tool: Tool) => {
      const merged: Record<string, unknown> = {
        ...meta,
        ...(overrides[tool] ?? {}),
      };
      const kept: Record<string, unknown> = {};
      for (const key of AGENT_FIELDS[tool] ?? []) {
        if (merged[key] !== undefined) kept[key] = merged[key];
      }
      return kept;
    };
    for (const tool of ["claude", "gemini"] as const) {
      if (!spec.tools.has(tool)) continue;
      outputs.push({
        kind: "file",
        path: `.${tool}/agents/${name}.md`,
        content: `${renderFrontmatter(pick(tool))}\n${note}${body}`,
      });
    }
    if (spec.tools.has("codex")) {
      const toml = [
        `# ${MARK} from ${rel}`,
        `name = ${tomlString(meta["name"])}`,
        `description = ${tomlString(meta["description"])}`,
        `developer_instructions = ${tomlString(body.trim())}`,
        "",
      ].join("\n");
      outputs.push({
        kind: "file",
        path: `.codex/agents/${name}.toml`,
        content: toml,
      });
    }
  }
  return outputs;
}

export function plan(
  spec: ProjectSpec,
  owned: ReadonlyMap<string, string> = new Map(),
): Output[] {
  const outputs = [
    ...skillOutputs(spec),
    ...ruleOutputs(spec),
    ...agentOutputs(spec),
    ...mcpOutputs(spec),
    ...hookOutputs(spec),
  ];
  if (spec.packageRules && spec.tools.has("claude")) {
    outputs.push(...packageRuleOutputs(spec.root, spec.packageRules, owned));
  }
  return outputs;
}

/** Directories every entry of which must be declared by the plan. */
export function censusDirs(spec: ProjectSpec): string[] {
  const dirs = [
    ".claude/skills",
    ".claude/agents",
    ".claude/commands",
    ".gemini/agents",
    ".codex/agents",
    ".grok/skills",
    `${RULES_DIR}/pmcp`,
  ];
  if (spec.packageRules) dirs.push(`${RULES_DIR}/${spec.packageRules.dir}`);
  return dirs;
}
