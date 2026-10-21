import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "./helpers.js";

const config =
  '[targets]\ntools = ["claude", "codex"]\n[hooks.guards.git.stage_all]\nmode = "ask"\n[sessions]\nstate_dir = ".state"\n[sessions.pause]\n';

it("lists compiled runtime/event bindings with modes and TOML sources", async (t) => {
  const { run } = fixture(t, config);
  const result = await run("hooks", "list", "--json");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).policies).toContainEqual(
    expect.objectContaining({
      runtime: "codex",
      event: "before_tool",
      policy: "git.stage_all",
      mode: "ask",
      source: "hooks.guards.git.stage_all",
    }),
  );
});

it.for([
  ["claude", "ask"],
  ["codex", "deny"],
] as const)(
  "renders %s decisions through its native adapter",
  async ([runtime, verdict], t) => {
    const { run } = fixture(t, config);
    const result = await run(
      "hooks",
      "test",
      "--runtime",
      runtime,
      "--event",
      "before_tool",
      "--command",
      "git add -A",
      "--json",
    );
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out);
    expect(report.decision.verdict).toBe(verdict);
    expect(report.policies).toContainEqual(
      expect.objectContaining({
        policy: "git.stage_all",
        verdict: "ask",
        durationMs: expect.any(Number),
      }),
    );
    expect(report.rendered.stdout).toContain(verdict);
  },
);

it("runs pause policies against isolated seed state and leaves the seed unchanged", async (t) => {
  const { root, run } = fixture(t, config);
  const path = join(root, "state.json");
  const seed = JSON.stringify({
    pause: {
      by: "operator",
      reason: "review",
      since: new Date().toISOString(),
    },
  });
  writeFileSync(path, seed);
  const result = await run(
    "hooks",
    "test",
    "--runtime",
    "claude",
    "--event",
    "before_tool",
    "--path",
    "fixture.txt",
    "--session-state",
    path,
    "--json",
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).decision.verdict).toBe("deny");
  expect(readFileSync(path, "utf8")).toBe(seed);
});

it("rejects incompatible input selectors and unknown runtime/event values", async (t) => {
  const { run } = fixture(t, config);
  expect(
    (await run("hooks", "test", "--runtime", "other", "--event", "before_tool"))
      .code,
  ).toBe(2);
  expect(
    (await run("hooks", "test", "--runtime", "claude", "--event", "invalid"))
      .code,
  ).toBe(2);
  expect(
    (
      await run(
        "hooks",
        "test",
        "--runtime",
        "claude",
        "--event",
        "before_tool",
        "--command",
        "git status",
        "--path",
        "x",
      )
    ).code,
  ).toBe(2);
});
