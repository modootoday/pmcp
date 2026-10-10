import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { readCatalog } from "../src/catalog.js";

function skill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\nBody.\n`,
  );
}

/** The layout the projector writes: canonical under .agents, links for tools that need them. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-layout-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "repo", private: true, workspaces: ["packages/*"] }),
  );
  skill(join(root, ".agents", "skills", "release-notes"), "release-notes");
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  symlinkSync(
    "../../.agents/skills/release-notes",
    join(root, ".claude", "skills", "release-notes"),
  );

  const alpha = join(root, "packages", "alpha");
  mkdirSync(alpha, { recursive: true });
  writeFileSync(
    join(alpha, "package.json"),
    JSON.stringify({ name: "@x/alpha" }),
  );
  skill(join(alpha, ".agents", "skills", "deploy-notes"), "deploy-notes");
  mkdirSync(join(alpha, ".gemini", "skills"), { recursive: true });
  symlinkSync(
    "../../../../.agents/skills/release-notes",
    join(alpha, ".gemini", "skills", "release-notes"),
  );

  const legacy = join(root, "packages", "legacy");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    join(legacy, "package.json"),
    JSON.stringify({ name: "@x/legacy" }),
  );
  skill(join(legacy, ".agent", "skills", "old-notes"), "old-notes");
  return root;
}

it("reads .agents/skills and still reads the legacy .agent/skills", () => {
  const names = readCatalog({ roots: [], workspaces: [repository()] }).map(
    (e) => e.name,
  );
  expect(names).toEqual([
    "@x/alpha/deploy-notes",
    "@x/legacy/old-notes",
    "repo/release-notes",
  ]);
});

it("does not list a generated tool link as a second skill", () => {
  const entries = readCatalog({ roots: [], workspaces: [repository()] });
  const releaseNotes = entries.filter((e) => e.slug === "release-notes");
  expect(releaseNotes).toHaveLength(1);
  expect(releaseNotes[0]!.path).toMatch(
    /\.agents\/skills\/release-notes\/SKILL\.md$/u,
  );
});
