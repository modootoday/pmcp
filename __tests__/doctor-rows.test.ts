import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { doctor } from "../src/project/doctor.js";
import { readSpec } from "../src/project/spec.js";

const UI =
  '[targets]\ntools = ["claude"]\n[sessions]\nstate_dir = "s"\n[sessions.registry]\n[ui.claude]\nstatus_band = false\n';
const run = () => ({ missing: true, status: null, stdout: "" });

function rows(t: TestContext, toml: string, projected: boolean) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-doctor-rows-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), toml);
  const spec = () => readSpec(readConfig(join(root, "pmcp.toml")));
  if (projected) {
    const result = project(spec(), { check: false });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
  }
  return doctor(spec(), { run, home: root }).filter(
    (row) =>
      row.check === "permissions owned" ||
      row.check === "ui.claude mod settings",
  );
}

describe("doctor rows for Claude", () => {
  it("shows the permissions row even when nothing is declared", (t) => {
    expect(rows(t, '[targets]\ntools = ["claude"]\n', false)).toEqual([
      {
        tool: "claude",
        check: "permissions owned",
        status: "ok",
        detail: "none declared",
      },
    ]);
  });

  it("shows the projected [ui.claude] switches", (t) => {
    expect(rows(t, UI, true)).toContainEqual({
      tool: "claude",
      check: "ui.claude mod settings",
      status: "ok",
      detail:
        "sessions_pane on, status_band off, commands on, hold_foreign_edits on; the mod loads with the pmcp plugin",
    });
  });

  it("fails the ui.claude row until the settings are projected", (t) => {
    expect(rows(t, UI, false)).toContainEqual({
      tool: "claude",
      check: "ui.claude mod settings",
      status: "fail",
      detail:
        ".agents/pmcp-hooks/ui-claude.json does not match [ui.claude]; run pmcp project",
    });
  });

  it("projects [git.worktrees] root for the mod, or the default root", (t) => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-ui-root-"));
    t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
      join(root, "pmcp.toml"),
      `${UI}[git.worktrees]\nroot = "../desks"\n`,
    );
    const spec = readSpec(readConfig(join(root, "pmcp.toml")));
    expect(spec.uiClaude?.worktreeRoot).toBe("../desks");
    writeFileSync(join(root, "pmcp.toml"), UI);
    expect(
      readSpec(readConfig(join(root, "pmcp.toml"))).uiClaude?.worktreeRoot,
    ).toBe(".claude/worktrees");
  });
});
