/**
 * Asks each tool what it loads, through its own listing commands only: no
 * model is called. A tool whose CLI is not installed is skipped, not failed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "smol-toml";

import { project } from "./apply.js";
import { ANTIGRAVITY_MCP_PLUGIN, serversForTool } from "./mcp.js";
import { splitFrontmatter } from "./frontmatter.js";
import { agentNames, skillNames } from "./plan.js";
import type { ProjectSpec, Tool } from "./spec.js";

export interface RunResult {
  /** The executable was not found. */
  readonly missing: boolean;
  readonly status: number | null;
  readonly stdout: string;
}

export type Runner = (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string | undefined>>,
) => RunResult;

export const spawnRunner: Runner = (command, args, cwd, env) => {
  const result = spawnSync(command, [...args], {
    cwd,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 1 << 26,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    missing: code === "ENOENT",
    status: result.status,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

export type Status = "ok" | "fail" | "skip";

export interface Finding {
  readonly tool: Tool | "project";
  readonly check: string;
  readonly status: Status;
  readonly detail?: string;
}

export interface DoctorOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run: Runner;
  readonly home: string;
  readonly only?: ReadonlySet<Tool>;
}

const missingFrom = (
  names: readonly string[],
  present: (name: string) => boolean,
) => names.filter((name) => !present(name));

function verdict(
  tool: Tool,
  check: string,
  missing: readonly string[],
): Finding {
  if (missing.length === 0) return { tool, check, status: "ok" };
  return {
    tool,
    check,
    status: "fail",
    detail: `missing: ${missing.join(", ")}`,
  };
}

function listed(
  tool: Tool,
  check: string,
  result: RunResult,
  names: readonly string[],
  present: (out: string, name: string) => boolean,
): Finding {
  if (result.missing)
    return { tool, check, status: "skip", detail: "not installed" };
  if (result.status !== 0) {
    return {
      tool,
      check,
      status: "fail",
      detail: `exit ${result.status}: ${result.stdout.trim().split("\n").pop() ?? ""}`,
    };
  }
  return verdict(
    tool,
    check,
    missingFrom(names, (name) => present(result.stdout, name)),
  );
}

const lines = (out: string) => out.split("\n").map((l) => l.trim());

function geminiConnected(out: string, alias: string): boolean {
  const sections = out.split(
    /(?=^[^\p{L}\p{N}\r\n]*[A-Za-z0-9][A-Za-z0-9_-]*:\s)/gmu,
  );
  const header = new RegExp(`^[^\\p{L}\\p{N}\\r\\n]*${alias}:\\s`, "mu");
  const section = sections.find((entry) => header.test(entry));
  if (section === undefined) {
    return false;
  }
  const statuses = [
    ...section.matchAll(/\s-\s+(Connected|Disconnected)\s*$/gimu),
  ];
  return statuses.at(-1)?.[1]?.toLowerCase() === "connected";
}

function claude(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const aliases = serversForTool(spec, "claude").map(([alias]) => alias);
  if (aliases.length === 0) return [];
  const result = o.run("claude", ["mcp", "list"], spec.root);
  return [
    listed("claude", "mcp servers connected", result, aliases, (out, alias) =>
      lines(out).some(
        (l) =>
          l.startsWith(`${alias}:`) &&
          /connected/iu.test(l) &&
          !/failed/iu.test(l),
      ),
    ),
  ];
}

function codex(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const findings: Finding[] = [];
  const config = join(o.home, ".codex/config.toml");
  let trusted = false;
  if (existsSync(config)) {
    const projects =
      (
        parse(readFileSync(config, "utf8")) as {
          projects?: Record<string, { trust_level?: string }>;
        }
      ).projects ?? {};
    const root = spec.root.replace(/\/$/u, "");
    trusted =
      projects[root]?.trust_level === "trusted" ||
      projects[`${root}/`]?.trust_level === "trusted";
  }
  findings.push(
    trusted
      ? { tool: "codex", check: "project trusted", status: "ok" }
      : {
          tool: "codex",
          check: "project trusted",
          status: "fail",
          detail: "untrusted projects skip .codex/ and .agents/",
        },
  );
  const aliases = serversForTool(spec, "codex").map(([alias]) => alias);
  if (aliases.length > 0) {
    const result = o.run("codex", ["mcp", "list"], spec.root);
    findings.push(
      listed("codex", "mcp servers listed", result, aliases, (out, alias) =>
        lines(out).some((l) => l.split(/\s+/u)[0] === alias),
      ),
    );
  }
  return findings;
}

function gemini(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const findings: Finding[] = [];
  const skills = skillNames(spec.root);
  if (skills.length > 0) {
    const result = o.run("gemini", ["skills", "list"], spec.root);
    findings.push(
      listed("gemini", "project skills listed", result, skills, (out, name) =>
        lines(out).some((l) => l.startsWith(`${name} [`)),
      ),
    );
  }
  const aliases = serversForTool(spec, "gemini").map(([alias]) => alias);
  if (aliases.length > 0) {
    const result = o.run("gemini", ["mcp", "list"], spec.root);
    findings.push(
      listed(
        "gemini",
        "mcp servers connected",
        result,
        aliases,
        geminiConnected,
      ),
    );
  }
  return findings;
}

interface GrokInspect {
  projectTrusted?: boolean;
  projectInstructions?: { path: string }[];
  skills?: { name: string }[];
  mcpServers?: { name: string }[];
}

function grok(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const result = o.run("grok", ["inspect", "--json"], spec.root);
  if (result.missing)
    return [
      {
        tool: "grok",
        check: "inspect",
        status: "skip",
        detail: "not installed",
      },
    ];
  let report: GrokInspect;
  try {
    report = JSON.parse(
      result.stdout.slice(result.stdout.indexOf("{")),
    ) as GrokInspect;
  } catch {
    return [
      {
        tool: "grok",
        check: "inspect",
        status: "fail",
        detail: "grok inspect --json did not return JSON",
      },
    ];
  }
  const findings: Finding[] = [];
  findings.push(
    report.projectTrusted
      ? { tool: "grok", check: "project trusted", status: "ok" }
      : {
          tool: "grok",
          check: "project trusted",
          status: "fail",
          detail: "untrusted projects skip .grok/ MCP and hooks",
        },
  );
  const skills = new Set((report.skills ?? []).map((s) => s.name));
  findings.push(
    verdict(
      "grok",
      "project skills listed",
      missingFrom(skillNames(spec.root), (n) => skills.has(n)),
    ),
  );
  // Grok ignores paths:, so any rule it loads from .claude/rules loads in every session.
  const leaked = (report.projectInstructions ?? []).filter((i) =>
    i.path.includes("/.claude/rules/"),
  );
  findings.push(
    leaked.length === 0
      ? { tool: "grok", check: "no .claude/rules loaded", status: "ok" }
      : {
          tool: "grok",
          check: "no .claude/rules loaded",
          status: "fail",
          detail: `${leaked.length} rule files load unscoped`,
        },
  );
  const servers = new Set((report.mcpServers ?? []).map((s) => s.name));
  const aliases = serversForTool(spec, "grok").map(([alias]) => alias);
  if (aliases.length > 0) {
    findings.push(
      verdict(
        "grok",
        "mcp servers listed",
        missingFrom(aliases, (n) => servers.has(n)),
      ),
    );
  }
  return findings;
}

/** Antigravity has no listing command for project assets; check what makes it drop them. */
function antigravity(spec: ProjectSpec, options: DoctorOptions): Finding[] {
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

export function doctor(spec: ProjectSpec, options: DoctorOptions): Finding[] {
  const check = project(spec, { check: true });
  const findings: Finding[] = [
    check.code === 0
      ? { tool: "project", check: "outputs match sources", status: "ok" }
      : {
          tool: "project",
          check: "outputs match sources",
          status: "fail",
          detail: check.problems.slice(0, 5).join("; "),
        },
  ];
  const wanted = (tool: Tool) =>
    spec.tools.has(tool) &&
    (options.only === undefined || options.only.has(tool));
  if (wanted("claude")) findings.push(...claude(spec, options));
  if (wanted("codex")) findings.push(...codex(spec, options));
  if (wanted("gemini")) findings.push(...gemini(spec, options));
  if (wanted("grok")) findings.push(...grok(spec, options));
  if (wanted("antigravity")) {
    findings.push(...antigravity(spec, options));
  }
  return findings;
}
