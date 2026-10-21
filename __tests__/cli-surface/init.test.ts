import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readConfig } from "../../src/config.js";
import { readSpec } from "../../src/project/spec.js";
import { fixture } from "./helpers.js";

it.for(["solo", "multi-session"])(
  "creates a compilable %s preset using git detection",
  async (preset, t) => {
    const { root, run } = fixture(t);
    unlinkSync(join(root, "pmcp.toml"));
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    execFileSync("git", [
      "-C",
      root,
      "remote",
      "add",
      "upstream",
      "/tmp/unused-origin",
    ]);
    execFileSync("git", [
      "-C",
      root,
      "symbolic-ref",
      "refs/remotes/upstream/HEAD",
      "refs/remotes/upstream/trunk",
    ]);
    const result = await run("init", "--preset", preset);
    expect(result.code).toBe(0);
    const config = readConfig(join(root, "pmcp.toml"));
    expect(readSpec(config).tools.has("claude")).toBe(true);
    expect(config.raw.git).toMatchObject({
      remote: "upstream",
      mainline: { branch: "trunk" },
    });
    expect(result.err).toContain("why");
  },
);

it("refuses overwrite and invalid presets before touching an existing file", async (t) => {
  const { root, run } = fixture(t);
  const before = readFileSync(join(root, "pmcp.toml"), "utf8");
  expect((await run("init")).code).toBe(2);
  expect((await run("init", "--preset", "invalid", "--force")).code).toBe(2);
  expect(readFileSync(join(root, "pmcp.toml"), "utf8")).toBe(before);
  expect((await run("init", "--force")).code).toBe(0);
});
