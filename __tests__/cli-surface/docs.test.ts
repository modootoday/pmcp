import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMMANDS } from "../../src/commands/registry.js";

it("documents every JSON inspection schema and keeps registry names within eleven columns", () => {
  const root = join(import.meta.dirname, "../..");
  const doc = readFileSync(join(root, "docs/commands/index.html"), "utf8");
  const schemas = JSON.parse(
    readFileSync(join(root, "docs/commands/schemas.json"), "utf8"),
  ).schemas;
  for (const name of [
    "status",
    "hooks-list",
    "hooks-test",
    "sessions-status",
    "logs",
    "git-worktree-list",
    "mcp-status",
  ]) {
    expect(schemas[name]).toBeDefined();
    expect(doc).toContain(name);
  }
  expect(COMMANDS.filter((command) => command.name.length > 11)).toEqual([]);
  for (const name of ["status", "init", "hooks"]) {
    expect(doc).toContain('<h2 id="' + name + '">' + name + "</h2>");
  }
});
