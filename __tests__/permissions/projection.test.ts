import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readConfig } from "../../src/config.js";
import { doctor } from "../../src/project/doctor.js";
import { readSpec } from "../../src/project/spec.js";
import { claudeOnly, fixture, list, SETTINGS, TEN } from "./_shared.js";

describe("[permissions.claude] projection", () => {
  it("projects the ten asks verbatim and records ownership in the lock", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ${list(TEN)}\n`,
      { defaultMode: "plan", env: { A: "1" } },
    );
    expect(f.apply().code).toBe(0);
    const settings = f.settings();
    expect(settings.permissions).toEqual({ ask: TEN });
    expect(settings.defaultMode).toBe("plan");
    expect(settings.env).toEqual({ A: "1" });
    const entry = f
      .lock()
      .outputs.find(
        (o: { path: string }) => o.path === `${SETTINGS}#permissions.ask`,
      );
    expect(entry.managed).toEqual(TEN);
  });

  it("keeps unmanaged entries, borrows identical ones and never owns them", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Read(.env)", "Bash(git push:*)"]\n`,
      {
        defaultMode: "acceptEdits",
        permissions: {
          ask: ["Bash(rm:*)", "Read(.env)", "Bash(rm:*)"],
          deny: ["WebSearch"],
          additionalDirectories: ["../x"],
        },
      },
    );
    expect(f.apply().code).toBe(0);
    expect(f.settings().permissions).toEqual({
      ask: ["Bash(rm:*)", "Read(.env)", "Bash(rm:*)", "Bash(git push:*)"],
      deny: ["WebSearch"],
      additionalDirectories: ["../x"],
    });
    expect(
      f
        .lock()
        .outputs.find((o: { path: string }) =>
          o.path.endsWith("#permissions.ask"),
        ).managed,
    ).toEqual(["Bash(git push:*)"]);
    writeFileSync(f.config, `${claudeOnly}[permissions.claude]\nask = []\n`);
    expect(f.apply().code).toBe(0);
    expect(f.settings()).toEqual({
      defaultMode: "acceptEdits",
      permissions: {
        ask: ["Bash(rm:*)", "Read(.env)", "Bash(rm:*)"],
        deny: ["WebSearch"],
        additionalDirectories: ["../x"],
      },
    });
    expect(JSON.stringify(f.lock())).not.toContain("permissions");
  });

  it("removes owned entries when the table goes and keeps the rest", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\ndeny = ["Read(**/.dev.vars)"]\nallow = ["Bash(npm test)"]\n`,
      { permissions: { deny: ["WebSearch"] } },
    );
    expect(f.apply().code).toBe(0);
    expect(f.settings().permissions).toEqual({
      deny: ["WebSearch", "Read(**/.dev.vars)"],
      allow: ["Bash(npm test)"],
    });
    writeFileSync(f.config, claudeOnly);
    expect(f.apply().code).toBe(0);
    expect(f.settings()).toEqual({ permissions: { deny: ["WebSearch"] } });
  });

  it("is idempotent and check writes nothing", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ${list(TEN)}\n`,
    );
    expect(f.apply().code).toBe(0);
    const first = f.text();
    const lock = readFileSync(join(f.root, "pmcp.lock"), "utf8");
    expect(f.apply().code).toBe(0);
    expect(f.text()).toBe(first);
    const before = statSync(join(f.root, SETTINGS)).mtimeMs;
    expect(f.check()).toMatchObject({ code: 0, problems: [] });
    expect(statSync(join(f.root, SETTINGS)).mtimeMs).toBe(before);
    expect(readFileSync(join(f.root, "pmcp.lock"), "utf8")).toBe(lock);
  });

  it("reports drift for a missing owned or declared entry and repairs it", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Read(.env)"]\n`,
      { model: "x" },
    );
    expect(f.apply().code).toBe(0);
    writeFileSync(join(f.root, SETTINGS), JSON.stringify({ model: "x" }));
    expect(f.check()).toMatchObject({
      code: 2,
      problems: [
        "drift: .claude/settings.json#permissions.ask missing Read(.env)",
      ],
    });
    expect(f.apply().code).toBe(0);
    writeFileSync(f.config, `${claudeOnly}[permissions.claude]\nask = []\n`);
    expect(f.check()).toMatchObject({
      code: 2,
      problems: [
        "drift: .claude/settings.json#permissions.ask no longer declared Read(.env)",
      ],
    });
  });

  it("reports a hand-edited owned entry as a conflict and refuses to project", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Bash(git push:*)", "Read(.env)"]\n`,
    );
    expect(f.apply().code).toBe(0);
    const edited = {
      permissions: { ask: ["Bash(git push --force:*)", "Read(.env)"] },
    };
    writeFileSync(join(f.root, SETTINGS), JSON.stringify(edited));
    const conflict =
      "conflict: .claude/settings.json#permissions.ask owned entry edited or removed Bash(git push:*)";
    expect(f.check()).toMatchObject({ code: 2, problems: [conflict] });
    expect(f.apply()).toMatchObject({ code: 3, problems: [conflict] });
    writeFileSync(f.config, claudeOnly);
    expect(f.apply().code).toBe(3);
    expect(f.settings()).toEqual(edited);
  });

  it("refuses a bucket that is not a list without touching the file", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Read(.env)"]\n`,
      { permissions: { ask: "Read(.env)" } },
    );
    const before = f.text();
    const result = f.apply();
    expect(result.code).toBe(3);
    expect(result.problems[0]).toContain(
      "permissions.ask is not a list of strings",
    );
    expect(f.text()).toBe(before);
    expect(existsSync(join(f.root, "pmcp.lock"))).toBe(false);
  });

  it("leaves Codex and an unselected Claude untouched", (t) => {
    const f = fixture(
      t,
      `[targets]\ntools = ["codex"]\n[permissions.claude]\nask = ${list(TEN)}\n`,
    );
    mkdirSync(join(f.root, ".codex"));
    writeFileSync(
      join(f.root, ".codex/config.toml"),
      'approval_policy = "on-request"\n',
    );
    expect(f.apply().code).toBe(0);
    expect(existsSync(join(f.root, SETTINGS))).toBe(false);
    expect(readFileSync(join(f.root, ".codex/config.toml"), "utf8")).toBe(
      'approval_policy = "on-request"\n',
    );
    writeFileSync(
      f.config,
      `[targets]\ntools = ["claude", "codex"]\n[permissions.claude]\nask = ${list(TEN)}\n`,
    );
    expect(f.apply().code).toBe(0);
    expect(f.settings().permissions.ask).toEqual(TEN);
    expect(readFileSync(join(f.root, ".codex/config.toml"), "utf8")).toBe(
      'approval_policy = "on-request"\n',
    );
  });

  it("shows a permissions row in doctor", (t) => {
    const f = fixture(
      t,
      `${claudeOnly}[permissions.claude]\nask = ["Read(.env)", "Bash(git push:*)"]\n`,
      { permissions: { ask: ["Read(.env)"] } },
    );
    expect(f.apply().code).toBe(0);
    const run = () => ({ missing: true, status: null, stdout: "" });
    const row = doctor(readSpec(readConfig(f.config)), {
      run,
      home: f.root,
    }).find((finding) => finding.check === "permissions owned");
    expect(row).toEqual({
      tool: "claude",
      check: "permissions owned",
      status: "ok",
      detail: "ask: 1 owned, 1 borrowed",
    });
  });
});
