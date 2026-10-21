import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readConfig } from "../../src/config.js";
import { fingerprint } from "../../src/project/apply/_shared.js";
import { writeNative } from "../../src/project/apply/native.js";
import { doctor } from "../../src/project/doctor.js";
import { jsonOutput } from "../../src/project/outputs.js";
import { readSpec } from "../../src/project/spec.js";
import { claudeOnly, fixture, SETTINGS } from "./_shared.js";

const overlap =
  "overlap: .claude/settings.json#permissions.deny has unmanaged Read(.env), declared in ask";

describe("[permissions.claude] unmanaged overlap", () => {
  it("warns in check and doctor without refusing or removing", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Read(.env)", "Bash(git push:*)"]\n`,
      { permissions: { deny: ["Read(.env)"] } },
    );
    expect(f.apply().code).toBe(0);
    expect(f.settings().permissions.deny).toEqual(["Read(.env)"]);
    expect(f.check()).toMatchObject({
      code: 0,
      problems: [],
      warnings: [overlap],
    });
    const run = () => ({ missing: true, status: null, stdout: "" });
    const row = doctor(readSpec(readConfig(f.config)), {
      run,
      home: f.root,
    }).find((finding) => finding.check === "permissions owned");
    expect(row).toEqual({
      tool: "claude",
      check: "permissions owned",
      status: "warn",
      detail: `ask: 2 owned, 0 borrowed; ${overlap}`,
    });
  });
});

describe("plan-to-write fingerprint", () => {
  it("refuses to replace a native file that changed after the plan", (t) => {
    const f = fixture(t, claudeOnly, { model: "x" });
    const planned = fingerprint(join(f.root, SETTINGS));
    writeFileSync(join(f.root, SETTINGS), JSON.stringify({ model: "y" }));
    const output = jsonOutput(SETTINGS, ["permissions", "ask"], ["Read(.env)"]);
    expect(() =>
      writeNative(f.root, [output], [], new Map([[SETTINGS, planned]])),
    ).toThrow("changed since the plan");
    expect(readFileSync(join(f.root, SETTINGS), "utf8")).toBe(
      JSON.stringify({ model: "y" }),
    );
  });

  it("writes when the file is as planned", (t) => {
    const f = fixture(t, claudeOnly, { model: "x" });
    const planned = fingerprint(join(f.root, SETTINGS));
    const output = jsonOutput(SETTINGS, ["permissions", "ask"], ["Read(.env)"]);
    writeNative(f.root, [output], [], new Map([[SETTINGS, planned]]));
    expect(f.settings().permissions.ask).toEqual(["Read(.env)"]);
  });
});
