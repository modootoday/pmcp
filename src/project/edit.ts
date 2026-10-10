/**
 * add copies a catalog skill or agent into .agents/ so every tool finds it
 * natively; remove deletes one and its pmcp.toml tables. Both reproject after.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { kindOf, type SkillEntry } from "../catalog.js";
import { renderFrontmatter, splitFrontmatter } from "./frontmatter.js";
import { ProjectError } from "./package-rules.js";

/** Fields a canonical agent keeps; the rest are tool-specific and go to pmcp.toml. */
const CROSS_TOOL = ["name", "description"];

const tomlValue = (value: unknown) => JSON.stringify(value);

export function findEntry(
  entries: readonly SkillEntry[],
  wanted: string,
): SkillEntry {
  const exact = entries.filter((e) => e.name === wanted);
  if (exact.length === 1 && exact[0]) return exact[0];
  const bySlug = entries.filter(
    (e) => e.slug === wanted || e.slug.endsWith(`/${wanted}`),
  );
  if (bySlug.length === 1 && bySlug[0]) return bySlug[0];
  if (bySlug.length > 1) {
    throw new ProjectError(
      `${wanted} is ambiguous: ${bySlug.map((e) => e.name).join(", ")}`,
    );
  }
  throw new ProjectError(`no catalog skill or agent named ${wanted}`);
}

export interface Added {
  readonly kind: "skill" | "agent";
  readonly name: string;
  readonly path: string;
}

export function addEntry(root: string, entry: SkillEntry): Added {
  const kind = kindOf(entry);
  if (kind !== "skill" && kind !== "agent") {
    throw new ProjectError(
      `${entry.name} is a ${kind}; only skills and agents are added to .agents/`,
    );
  }
  const { meta, body } = splitFrontmatter(readFileSync(entry.path, "utf8"));
  const name = basename(entry.slug);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
    throw new ProjectError(
      `${entry.name}: ${name} is not a usable directory name`,
    );
  }

  if (kind === "skill") {
    const dest = join(root, ".agents/skills", name);
    if (existsSync(dest))
      throw new ProjectError(`.agents/skills/${name} already exists`);
    const source = entry.root ?? dirname(entry.path);
    mkdirSync(dirname(dest), { recursive: true });
    if (statSync(source).isDirectory()) {
      cpSync(source, dest, { recursive: true });
    } else {
      mkdirSync(dest);
    }
    // The agentskills.io format requires the frontmatter name to equal the directory.
    const head = renderFrontmatter({
      ...meta,
      name,
      description: meta["description"] ?? entry.description,
    });
    writeFileSync(
      join(dest, "SKILL.md"),
      `${head}\n${body.replace(/^\n/u, "")}`,
    );
    return { kind, name, path: `.agents/skills/${name}` };
  }

  const dest = join(root, ".agents/agents", name);
  if (existsSync(dest))
    throw new ProjectError(`.agents/agents/${name} already exists`);
  const kept: Record<string, unknown> = {};
  const moved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...meta, name })) {
    if (CROSS_TOOL.includes(key)) kept[key] = value;
    else moved[key] = value;
  }
  mkdirSync(dest, { recursive: true });
  writeFileSync(
    join(dest, "agent.md"),
    `${renderFrontmatter(kept)}\n${body.replace(/^\n/u, "")}`,
  );
  if (Object.keys(moved).length > 0) {
    const config = join(root, "pmcp.toml");
    const lines = [
      `[agents.${name}.claude]`,
      ...Object.entries(moved).map(([k, v]) => `${k} = ${tomlValue(v)}`),
    ];
    const before = existsSync(config) ? readFileSync(config, "utf8") : "";
    const sep = before === "" || before.endsWith("\n\n") ? "" : "\n";
    writeFileSync(config, `${before}${sep}${lines.join("\n")}\n`);
  }
  return { kind, name, path: `.agents/agents/${name}/agent.md` };
}

/** Drops [skills.<name>] and [agents.<name>...] tables from pmcp.toml text. */
export function withoutTables(toml: string, name: string): string {
  const own = new RegExp(
    `^\\[(skills\\.${name}|agents\\.${name}(\\.[a-z]+)?)\\]\\s*$`,
    "u",
  );
  const out: string[] = [];
  let skipping = false;
  for (const line of toml.split("\n")) {
    if (/^\[/u.test(line)) skipping = own.test(line);
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/gu, "\n\n");
}

export function removeAsset(root: string, name: string): string[] {
  const removed: string[] = [];
  for (const rel of [`.agents/skills/${name}`, `.agents/agents/${name}`]) {
    if (!existsSync(join(root, rel))) continue;
    rmSync(join(root, rel), { recursive: true, force: true });
    removed.push(rel);
  }
  if (removed.length === 0)
    throw new ProjectError(`no skill or agent named ${name} in .agents/`);
  const config = join(root, "pmcp.toml");
  if (existsSync(config)) {
    const before = readFileSync(config, "utf8");
    const after = withoutTables(before, name);
    if (after !== before) writeFileSync(config, after);
  }
  return removed;
}
