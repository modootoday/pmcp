import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";
import { readGitConfig } from "../src/git/config.js";
import { FEATURES, GUARDS } from "../src/hooks/policies/index.js";
import { readSpec } from "../src/project/spec.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const doc = readFileSync(join(root, "docs/project-configuration.md"), "utf8");

// The idioms every reader uses to name its table in an error; a new table written the same way is found.
const NAMING = [
  /new Reader\(\s*\w+,\s*"([a-z_.]+)"/gu,
  /\[([a-z_]+(?:\.[a-z_]+)*)\] unknown (?:key|field|option|tool)/gu,
  /unknown key \[([a-z_.]+)\]/gu,
];
// Map-shaped and array tables name an entry, not themselves, in their errors.
const NAMED_ELSEWHERE = [
  "marketplaces",
  "mcp",
  "skills",
  "agents",
  "rules.packages",
  "hooks",
  "hooks.guards.custom",
  "hooks.shell",
  "hooks.edit",
  "logging.components",
  "tui",
  "mailbox",
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function acceptedTables(): string[] {
  const found = new Set(NAMED_ELSEWHERE);
  for (const file of sources(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const pattern of NAMING)
      for (const match of text.matchAll(pattern)) found.add(match[1]!);
  }
  for (const id of Object.keys(GUARDS)) found.add(`hooks.guards.${id}`);
  for (const id of Object.keys(FEATURES))
    found.add(id.startsWith("checks.") ? `hooks.${id}` : id);
  return [...found].sort();
}

function example(): string {
  const section = doc.slice(doc.indexOf("## A complete example"));
  const match = /```toml\n([\s\S]*?)```/u.exec(section);
  if (!match) throw new Error("the complete example has no toml block");
  return match[1]!;
}

describe("docs/project-configuration.md", () => {
  it("documents every table a reader accepts", () => {
    const tables = acceptedTables();
    expect(tables.length).toBeGreaterThan(40);
    const missing = tables.filter(
      (table) => !doc.includes(`[${table}]`) && !doc.includes(`[${table}.`),
    );
    expect(missing).toEqual([]);
  });

  it("gives a complete example every reader accepts", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "pmcp-docs-example-"));
    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    mkdirSync(join(dir, ".agents/guards"), { recursive: true });
    writeFileSync(join(dir, ".agents/guards/source-formatting.mjs"), "");
    writeFileSync(join(dir, "pmcp.toml"), example());
    const config = readConfig(join(dir, "pmcp.toml"));
    const spec = readSpec(config);
    const ids = spec.hookBundle?.policy?.guards.map((guard) => guard.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        ...Object.keys(GUARDS),
        ...Object.keys(FEATURES),
      ]),
    );
    expect(readGitConfig(config)?.deliver?.refuseDirectPush).toBe(true);
  });

  it("names no absolute home path", () => {
    const text = [doc, readFileSync(join(root, "README.md"), "utf8")].join();
    expect(text).not.toMatch(/\/home\/\w|\/Users\/\w/u);
  });
});
