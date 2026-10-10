/**
 * The projector's reading of pmcp.toml: which tools to write for, and the
 * per-asset settings that do not belong in the cross-tool sources under .agents/.
 */

import { ConfigError, type ProjectConfig } from "../config.js";
import { readMcp } from "./mcp-spec.js";
import { readHooks, type ShellHookSpec } from "./hook-spec.js";

export const TOOLS = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "antigravity",
] as const;
export type Tool = (typeof TOOLS)[number];

export type Invocation = "any" | "user";

export interface PackageRulesSpec {
  /** Path of the rule file inside each package, e.g. `.agent/rules/PACKAGE.RULE.md`. */
  readonly file: string;
  /** Subdirectory of `.claude/rules` the links go in. */
  readonly dir: string;
  /** Leading path segments dropped when a link name is derived. */
  readonly strip: readonly string[];
}

export interface McpServerSpec {
  readonly mailbox?: boolean;
  readonly command?: string;
  readonly url?: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly envVars?: readonly string[];
  readonly envFrom?: Readonly<
    Record<string, { readonly file: string; readonly pointer: string }>
  >;
  readonly cwd?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly headerEnv?: Readonly<Record<string, string>>;
  readonly bearerTokenEnvVar?: string;
  readonly native?: Partial<Record<Tool, Readonly<Record<string, number>>>>;
  readonly targets?: readonly Tool[];
  /** Tools the server should expose where a host can narrow them. */
  readonly tools?: readonly string[];
}

export interface ProjectSpec {
  readonly hooks?: readonly ShellHookSpec[];
  readonly root: string;
  readonly tools: ReadonlySet<Tool>;
  readonly skills: Readonly<Record<string, { invocation: Invocation }>>;
  readonly agents: Readonly<
    Record<string, Partial<Record<Tool, Record<string, unknown>>>>
  >;
  readonly packageRules: PackageRulesSpec | null;
  readonly mcp: Readonly<Record<string, McpServerSpec>>;
}

const NAME = /^[a-z0-9][a-z0-9-]*$/u;

type Table = Record<string, unknown>;

function table(path: string, where: string, value: unknown): Table {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(path, `${where} must be a table`);
  }
  return value as Table;
}

function strings(path: string, where: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ConfigError(path, `${where} must be a list of strings`);
  }
  return value;
}

function named(path: string, where: string, name: string): string {
  // Names become file names and dotted keys in the lock, so they stay plain.
  if (!NAME.test(name)) {
    throw new ConfigError(
      path,
      `${where} ${name}: use lowercase, digits and -`,
    );
  }
  return name;
}

export function readSpec(config: ProjectConfig): ProjectSpec {
  const path = config.path;
  const raw = config.raw;

  const targets = table(path, "[targets]", raw["targets"]);
  const tools = new Set<Tool>();
  if (targets["tools"] !== undefined) {
    for (const tool of strings(path, "[targets] tools", targets["tools"])) {
      if (!(TOOLS as readonly string[]).includes(tool)) {
        throw new ConfigError(path, `[targets] unknown tool ${tool}`);
      }
      tools.add(tool as Tool);
    }
  }

  const skills: Record<string, { invocation: Invocation }> = {};
  for (const [name, value] of Object.entries(
    table(path, "[skills]", raw["skills"]),
  )) {
    const entry = table(path, `[skills.${name}]`, value);
    const invocation = entry["invocation"] ?? "any";
    if (invocation !== "any" && invocation !== "user") {
      throw new ConfigError(
        path,
        `[skills.${name}] invocation must be "any" or "user"`,
      );
    }
    skills[named(path, "[skills]", name)] = { invocation };
  }

  const agents: Record<string, Partial<Record<Tool, Table>>> = {};
  for (const [name, value] of Object.entries(
    table(path, "[agents]", raw["agents"]),
  )) {
    const perTool: Partial<Record<Tool, Table>> = {};
    for (const [tool, fields] of Object.entries(
      table(path, `[agents.${name}]`, value),
    )) {
      if (!(TOOLS as readonly string[]).includes(tool)) {
        throw new ConfigError(path, `[agents.${name}] unknown tool ${tool}`);
      }
      perTool[tool as Tool] = table(path, `[agents.${name}.${tool}]`, fields);
    }
    agents[named(path, "[agents]", name)] = perTool;
  }

  const rules = table(path, "[rules]", raw["rules"]);
  let packageRules: PackageRulesSpec | null = null;
  if (rules["packages"] !== undefined) {
    const pkg = table(path, "[rules.packages]", rules["packages"]);
    const file = pkg["file"];
    if (typeof file !== "string" || file === "") {
      throw new ConfigError(path, "[rules.packages] file is required");
    }
    const dir = pkg["dir"] ?? "pkg";
    if (typeof dir !== "string" || !NAME.test(dir) || dir === "pmcp") {
      throw new ConfigError(
        path,
        '[rules.packages] dir must be a plain name other than "pmcp"',
      );
    }
    const strip =
      pkg["strip"] === undefined
        ? []
        : strings(path, "[rules.packages] strip", pkg["strip"]);
    packageRules = { file, dir, strip };
  }

  const mcp = readMcp(path, raw["mcp"]);
  const hooks = readHooks(path, config.dir, raw["hooks"]);

  return {
    root: config.dir,
    tools,
    skills,
    agents,
    packageRules,
    mcp,
    ...(hooks.length > 0 ? { hooks } : {}),
  };
}
