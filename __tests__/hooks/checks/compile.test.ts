import { describe, expect, it } from "vitest";
import { compileHooks } from "../../../src/hooks/compile.js";

const options = { root: process.cwd(), tools: new Set(["claude", "codex"]) };
const afterEdit = {
  validator_glob: "**/.agents/skills/*/validate.cjs",
  command: ["node", "{validator}"],
  debounce_seconds: 60,
  report: "context",
};

describe("check and stage-all declarations", () => {
  it("projects check lifecycle bindings without enabling sessions tables", () => {
    const result = compileHooks(
      {
        hooks: {
          checks: {
            after_edit: afterEdit,
            on_stop: { project_check: true, report: "context" },
          },
        },
      },
      options,
    );
    expect(result.policy?.guards.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["checks.after_edit", "checks.on_stop"]),
    );
    const text = JSON.stringify(result.edits);
    for (const event of ["after_tool", "prompt", "stop"])
      expect(text).toContain(event);
  });
  it("leaves absent checks and stage_all off", () => {
    const result = compileHooks({ hooks: { targets: ["claude"] } }, options);
    expect(
      result.policy?.guards.filter(
        (entry) =>
          entry.id === "git.stage_all" || entry.id.startsWith("checks."),
      ),
    ).toEqual([]);
  });
  it("drops stage_all with mode off, like every other guard", () => {
    const result = compileHooks(
      {
        hooks: {
          guards: {
            git: { stage_all: { mode: "off" }, push_without_verify: {} },
          },
        },
      },
      options,
    );
    const ids = result.policy?.guards.map((entry) => entry.id);
    expect(ids).toContain("git.push_without_verify");
    expect(ids).not.toContain("git.stage_all");
  });
  it.each([
    ["graded", "graded applies only to guards that grade"],
    ["invalid", "mode must be one of"],
  ])("rejects stage_all mode %s", (mode, message) => {
    expect(() =>
      compileHooks(
        { hooks: { guards: { git: { stage_all: { mode } } } } },
        options,
      ),
    ).toThrow(message);
  });
  it.each([
    { after_edit: { ...afterEdit, command: ["node", "script.cjs"] } },
    { after_edit: { ...afterEdit, debounce_seconds: -1 } },
    { after_edit: { ...afterEdit, validator_glob: "../*.cjs" } },
    { after_edit: { ...afterEdit, report: "block" } },
    { on_stop: { project_check: "yes" } },
    { unknown: {} },
  ])("rejects invalid check options %j", (checks) => {
    expect(() => compileHooks({ hooks: { checks } }, options)).toThrow();
  });
});
