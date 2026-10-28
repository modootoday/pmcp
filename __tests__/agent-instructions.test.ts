import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

const tracked = () =>
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

// Every agent reads AGENTS.md: Claude Code through the CLAUDE.md links, Gemini CLI through
// its context.fileName setting, so no GEMINI.md copy or link is kept beside it.
it("has Gemini CLI read AGENTS.md, with no GEMINI.md outside test fixtures", () => {
  const settings = JSON.parse(
    readFileSync(join(root, ".gemini/settings.json"), "utf8"),
  );
  expect(settings).toEqual({ context: { fileName: ["AGENTS.md"] } });
  expect(
    tracked().filter(
      (path) =>
        path.split("/").at(-1) === "GEMINI.md" && !path.includes("/fixtures/"),
    ),
  ).toEqual([]);
});

it("advises the same in the setup and migration skills", () => {
  for (const skill of ["pmcp-project-init", "agent-assets-migrate"]) {
    const text = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    expect(text).toContain('"context": { "fileName": ["AGENTS.md"] }');
    expect(text).not.toContain("ln -s AGENTS.md GEMINI.md");
    expect(text).not.toMatch(/CLAUDE\.md and GEMINI\.md linked/u);
  }
});
