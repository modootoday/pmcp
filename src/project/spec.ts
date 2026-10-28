import { ConfigError, type ProjectConfig } from "../config.js";
import { readMcp } from "./mcp-spec.js";
import { readHooks, type HookSpecs, type ShellHookSpec } from "./hook-spec.js";
import {
  readMarketplaces,
  type DeclaredMarketplace,
} from "../marketplace/declared/index.js";
import type { UiSettings } from "../ui/claude/reader/index.js";
import { readUiClaude } from "./ui-claude.js";
import { readGitConfig } from "../git/config.js";
import { readPermissions, type PermissionSpec } from "./permissions.js";
import { readHost, type HostSpec } from "./host-spec.js";
import { readBudget, type BudgetSettings } from "./budget.js";
import { envNames } from "../native/env-names.js";
import { TOOLS, type Tool } from "./tools.js";

export { TOOLS, type Tool };

export type Invocation = "any" | "user";

export interface PackageRulesSpec {
  readonly file: string;

  readonly dir: string;

  readonly strip: readonly string[];
}

export interface McpServerSpec {
  readonly auth?: "native" | "pmcp";
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

  readonly tools?: readonly string[];
}

export interface ProjectSpec {
  readonly hooks?: readonly ShellHookSpec[];
  readonly hookBundle?: HookSpecs["bundle"];
  readonly featureSources?: HookSpecs["sources"];
  // Configuration that still works but should move; printed by project and --check.
  readonly deprecations?: readonly string[];
  readonly root: string;
  readonly tools: ReadonlySet<Tool>;
  readonly skills: Readonly<Record<string, { invocation: Invocation }>>;
  readonly agents: Readonly<
    Record<string, Partial<Record<Tool, Record<string, unknown>>>>
  >;
  readonly packageRules: PackageRulesSpec | null;
  readonly mcp: Readonly<Record<string, McpServerSpec>>;
  readonly marketplaces?: readonly DeclaredMarketplace[];
  readonly uiClaude?: UiSettings;
  readonly permissions?: PermissionSpec;
  readonly host?: HostSpec;
  // [harness]: env names a harness group created in this project passes by default.
  readonly harness?: { readonly env: readonly string[] };
  // [budget]: limits project --check enforces and status shows.
  readonly budget?: BudgetSettings;
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
  // Restrict names because they become both filenames and dotted lock keys.
  if (!NAME.test(name)) {
    throw new ConfigError(
      path,
      `${where} ${name}: use lowercase, digits and -`,
    );
  }
  return name;
}

function readHarness(
  path: string,
  raw: unknown,
): { env: string[] } | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new ConfigError(path, "[harness] must be a table");
  for (const key of Object.keys(raw))
    if (key !== "env")
      throw new ConfigError(path, `[harness] unknown key ${key}`);
  try {
    return {
      env: envNames((raw as Record<string, unknown>)["env"], "[harness] env"),
    };
  } catch (error) {
    throw new ConfigError(path, (error as Error).message);
  }
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
    const codex = perTool.codex;
    if (codex?.["developer_instructions"] !== undefined)
      throw new ConfigError(
        path,
        `[agents.${name}.codex] developer_instructions comes from the body of .agents/agents/${name}/agent.md`,
      );
    const codexName = codex?.["name"];
    if (
      codexName !== undefined &&
      (typeof codexName !== "string" || !/^[a-z0-9_]+$/u.test(codexName))
    )
      throw new ConfigError(
        path,
        `[agents.${name}.codex] name must be lowercase letters, digits and underscores`,
      );
    if (
      codex?.["description"] !== undefined &&
      typeof codex["description"] !== "string"
    )
      throw new ConfigError(
        path,
        `[agents.${name}.codex] description must be a string`,
      );
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
  const hooks = readHooks(path, config.dir, raw, tools);
  const sessionHooks =
    hooks.bundle?.policy?.guards.some((g) => g.id === "sessions.registry") ??
    false;
  const marketplaces = readMarketplaces(
    raw["marketplaces"],
    config.dir,
    (m) => {
      throw new ConfigError(path, m);
    },
  );
  const uiClaude = readUiClaude(
    path,
    raw["ui"],
    sessionHooks,
    readGitConfig(config)?.worktrees?.root ?? ".claude/worktrees",
  );
  const permissions = readPermissions(path, raw["permissions"]);
  const host = readHost(path, raw["host"]);
  const harness = readHarness(path, raw["harness"]);
  let budget: BudgetSettings | null;
  try {
    budget = readBudget(raw["budget"]);
  } catch (error) {
    throw new ConfigError(path, (error as Error).message);
  }

  return {
    root: config.dir,
    tools,
    skills,
    agents,
    packageRules,
    mcp,
    ...(marketplaces.length > 0 ? { marketplaces } : {}),
    ...(uiClaude ? { uiClaude } : {}),
    ...(permissions ? { permissions } : {}),
    ...(host ? { host } : {}),
    ...(harness ? { harness } : {}),
    ...(budget ? { budget } : {}),
    ...(hooks.legacy.length > 0 ? { hooks: hooks.legacy } : {}),
    ...(hooks.bundle ? { hookBundle: hooks.bundle } : {}),
    ...(hooks.deprecations.length > 0
      ? { deprecations: hooks.deprecations }
      : {}),
    featureSources: hooks.sources,
  };
}
