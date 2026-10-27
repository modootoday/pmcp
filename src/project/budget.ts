// [budget]: limits on what every agent session loads, so instruction files and the skill list
// stay within what a project decided to spend, and paths a project keeps out of its tree stay
// out. Measured from the checkout; nothing is written.

import { lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { trackedFiles } from "./package-rules.js";
import { skillNames } from "./plan.js";
import type { ProjectSpec } from "./spec.js";

export interface BudgetSettings {
  readonly rootBytes?: number;
  readonly rootLines?: number;
  readonly packageBytes?: number;
  readonly skillsMax?: number;
  readonly forbidPaths: readonly string[];
}

const KEYS = [
  "root_bytes",
  "root_lines",
  "package_bytes",
  "skills_max",
  "forbid_paths",
];

// The instruction files a runtime loads from the root of the project.
const ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];

export function readBudget(value: unknown): BudgetSettings | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("[budget] must be a table");
  const table = value as Record<string, unknown>;
  const unknown = Object.keys(table).find((key) => !KEYS.includes(key));
  if (unknown) throw new Error(`unknown [budget] key ${unknown}`);
  const limit = (key: string): number | undefined => {
    const raw = table[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0)
      throw new Error(`[budget] ${key} must be a whole number`);
    return raw;
  };
  const forbid = table["forbid_paths"] ?? [];
  if (
    !Array.isArray(forbid) ||
    !forbid.every((item) => typeof item === "string" && item !== "")
  )
    throw new Error("[budget] forbid_paths must be a list of globs");
  const rootBytes = limit("root_bytes");
  const rootLines = limit("root_lines");
  const packageBytes = limit("package_bytes");
  const skillsMax = limit("skills_max");
  return {
    ...(rootBytes !== undefined ? { rootBytes } : {}),
    ...(rootLines !== undefined ? { rootLines } : {}),
    ...(packageBytes !== undefined ? { packageBytes } : {}),
    ...(skillsMax !== undefined ? { skillsMax } : {}),
    forbidPaths: forbid as string[],
  };
}

// A path glob: * within one segment, ** across segments, ? one character.
export function globPattern(glob: string): RegExp {
  let source = "";
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at]!;
    if (char === "*" && glob[at + 1] === "*") {
      const slash = glob[at + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      at += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  // A glob naming a directory also covers everything below it.
  return new RegExp(`^${source}(?:/.*)?$`, "u");
}

export interface BudgetRow {
  readonly key: string;
  // What was measured: a file, "skills", or a forbidden path.
  readonly subject: string;
  readonly value: number;
  readonly limit: number;
}

export interface BudgetReport {
  readonly rows: readonly BudgetRow[];
  readonly problems: readonly string[];
}

function regularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function measure(path: string): { bytes: number; lines: number } {
  const text = readFileSync(path);
  let lines = 0;
  for (const byte of text) if (byte === 10) lines += 1;
  if (text.length > 0 && text[text.length - 1] !== 10) lines += 1;
  return { bytes: text.length, lines };
}

export function checkBudget(
  spec: ProjectSpec,
  settings: BudgetSettings,
): BudgetReport {
  const rows: BudgetRow[] = [];
  const problems: string[] = [];
  const row = (key: string, subject: string, value: number, limit: number) => {
    rows.push({ key, subject, value, limit });
    if (value > limit)
      problems.push(`[budget] ${key}: ${subject} is ${value}, over ${limit}`);
  };
  for (const name of ROOT_FILES) {
    const path = join(spec.root, name);
    if (!regularFile(path)) continue;
    const { bytes, lines } = measure(path);
    if (settings.rootBytes !== undefined)
      row("root_bytes", name, bytes, settings.rootBytes);
    if (settings.rootLines !== undefined)
      row("root_lines", name, lines, settings.rootLines);
  }
  const tracked =
    settings.packageBytes !== undefined || settings.forbidPaths.length > 0
      ? trackedFiles(spec.root)
      : [];
  if (settings.packageBytes !== undefined) {
    const names = new Set(
      ["AGENTS.md", spec.packageRules?.file].filter(Boolean),
    );
    for (const file of tracked) {
      if (!file.includes("/") || !names.has(basename(file))) continue;
      const path = join(spec.root, file);
      if (regularFile(path))
        row("package_bytes", file, measure(path).bytes, settings.packageBytes);
    }
  }
  if (settings.skillsMax !== undefined)
    row(
      "skills_max",
      ".agents/skills",
      skillNames(spec.root).length,
      settings.skillsMax,
    );
  for (const glob of settings.forbidPaths) {
    const pattern = globPattern(glob);
    const found = tracked.filter((file) => pattern.test(file));
    rows.push({
      key: "forbid_paths",
      subject: glob,
      value: found.length,
      limit: 0,
    });
    for (const file of found)
      problems.push(`[budget] forbid_paths: ${file} matches ${glob}`);
  }
  return { rows, problems };
}
