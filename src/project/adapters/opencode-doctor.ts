import { realpathSync } from "node:fs";
import { join } from "node:path";

import type { DoctorOptions, Finding, RunResult } from "../doctor.js";
import { serversForTool } from "../mcp.js";
import { skillNames } from "../plan.js";
import type { ProjectSpec, Tool } from "../spec.js";

type ListingCheck = (
  tool: Tool,
  check: string,
  result: RunResult,
  names: readonly string[],
  present: (out: string, name: string) => boolean,
) => Finding;

export function isOpenCodeInventory(
  command: string,
  args: readonly string[],
): boolean {
  return (
    command === "opencode" &&
    args.length === 2 &&
    args[0] === "debug" &&
    args[1] === "skill"
  );
}

function connected(out: string, alias: string): boolean {
  const ansi = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    "gu",
  );
  const pattern = new RegExp(
    `^[^a-zA-Z0-9]*${alias}\\s+connected(?:\\s|$)`,
    "u",
  );
  return out
    .replace(ansi, "")
    .split("\n")
    .some((line) => pattern.test(line.trim()));
}

function projectSkill(out: string, root: string, name: string): boolean {
  try {
    const entries: unknown = JSON.parse(out);
    if (!Array.isArray(entries)) return false;
    const expected = realpathSync(
      join(root, ".agents/skills", name, "SKILL.md"),
    );
    return entries.some(
      (entry) =>
        entry?.name === name &&
        typeof entry.location === "string" &&
        realpathSync(entry.location) === expected,
    );
  } catch {
    return false;
  }
}

export function opencodeDoctor(
  spec: ProjectSpec,
  options: DoctorOptions,
  listed: ListingCheck,
): Finding[] {
  const findings: Finding[] = [];
  const names = skillNames(spec.root);
  if (names.length > 0) {
    findings.push(
      listed(
        "opencode",
        "project skills discovered",
        options.run("opencode", ["debug", "skill"], spec.root, options.env),
        names,
        (out, name) => projectSkill(out, spec.root, name),
      ),
    );
  }
  const aliases = serversForTool(spec, "opencode").map(([alias]) => alias);
  if (aliases.length > 0) {
    findings.push(
      listed(
        "opencode",
        "mcp servers connected",
        options.run("opencode", ["mcp", "list"], spec.root, options.env),
        aliases,
        connected,
      ),
    );
  }
  return findings;
}
