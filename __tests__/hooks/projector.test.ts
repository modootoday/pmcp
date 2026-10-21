import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import { VERSION } from "../../src/commands/version.js";
import { readConfig } from "../../src/config.js";
import { project } from "../../src/project/apply.js";
import { recordProjector } from "../../src/project/projector.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = [
  '[targets]\ntools = ["claude", "codex"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  "[hooks.checks.on_stop]\nproject_check = true\n",
].join("\n");

function checkout(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-projector-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "pmcp.toml");
  writeFileSync(config, TOML);
  const spec = () => readSpec(readConfig(config));
  const apply = (check = false) => {
    const result = project(spec(), { check });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    return result;
  };
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  return { root, spec, apply, read };
}

describe("which pmcp projected a checkout", () => {
  it("commits the same policy.json and pmcp.lock from checkouts at different paths", (t) => {
    const one = checkout(t);
    const two = checkout(t);
    expect(one.apply().code).toBe(0);
    expect(two.apply().code).toBe(0);
    for (const file of [".agents/pmcp-hooks/policy.json", "pmcp.lock"])
      expect(one.read(file)).toBe(two.read(file));
    expect(JSON.parse(one.read("pmcp.lock")).pmcp_version).toBe(VERSION);
    expect(one.read(".agents/pmcp-hooks/policy.json")).not.toContain(one.root);
  });

  it("reports a lock written by another pmcp version as drift", (t) => {
    const ws = checkout(t);
    ws.apply();
    expect(ws.apply(true).code).toBe(0);
    const lock = JSON.parse(ws.read("pmcp.lock"));
    writeFileSync(
      join(ws.root, "pmcp.lock"),
      JSON.stringify({ ...lock, pmcp_version: "0.16.1" }),
    );
    const checked = ws.apply(true);
    expect(checked.code).toBe(2);
    expect(checked.problems).toContain(
      `drift: pmcp.lock pmcp_version 0.16.1, this pmcp ${VERSION}`,
    );
  });

  it("records the projecting CLI per checkout in the state dir, never in committed files", (t) => {
    const ws = checkout(t);
    ws.apply();
    const cli = join(ws.root, "pkg/dist/cli.js");
    mkdirSync(join(ws.root, "pkg/dist"), { recursive: true });
    writeFileSync(cli, "");
    recordProjector(ws.spec(), join(ws.root, "pkg/../pkg/dist/cli.js"));
    const recorded = JSON.parse(ws.read(".state/projector.json"));
    expect(recorded).toEqual({ [ws.root]: { cli, version: VERSION } });
    recordProjector(ws.spec(), join(ws.root, "pmcp.toml"));
    expect(JSON.parse(ws.read(".state/projector.json"))).toEqual(recorded);
    expect(ws.apply(true).code).toBe(0);
  });
});
