import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { readCompiled, sha256 } from "../../src/hooks/compiled.js";
import { dispatch } from "../../src/hooks/dispatch.js";
import { silentLogger } from "../../src/logging/logger.js";
import {
  currentHooks,
  restartNotes,
} from "../../src/sessions/hook-freshness.js";
import type { LiveRecord } from "../../src/sessions/types.js";
import {
  compiled,
  fixture,
  guard,
  noGit,
  scratchStore,
} from "../hooks/helpers.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";

const live = (more: Partial<LiveRecord>): LiveRecord => ({
  session: "abcd1234-0001",
  live: true,
  ...more,
});

describe("live sessions told to restart for current hooks", () => {
  const current = { policySha256: "new", codexHooksChanged: 2_000 };

  it("names a Codex session started before .codex/hooks.json changed", () => {
    const old = live({
      runtime: "codex",
      startedAt: new Date(1_000).toISOString(),
      startPolicy: "new",
    });
    expect(restartNotes([old], current)[0]).toMatch(
      /\(codex\) started before \.codex\/hooks\.json changed/u,
    );
    const fresh = live({
      runtime: "codex",
      startedAt: new Date(3_000).toISOString(),
      startPolicy: "new",
    });
    expect(restartNotes([fresh], current)).toEqual([]);
  });

  it("names a session started under another or an untracked policy, and skips stale records", () => {
    expect(
      restartNotes(
        [live({ runtime: "claude", startPolicy: "old" })],
        current,
      )[0],
    ).toMatch(/an older pmcp policy/u);
    expect(restartNotes([live({ runtime: "gemini" })], current)[0]).toMatch(
      /an untracked pmcp policy/u,
    );
    expect(
      restartNotes([live({ runtime: "claude", startPolicy: "new" })], current),
    ).toEqual([]);
    expect(
      restartNotes([{ ...live({ startPolicy: "old" }), live: false }], current),
    ).toEqual([]);
  });

  it("reads the current policy hash and the Codex hook file time from the project", (t: TestContext) => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-fresh-"));
    t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, ".agents/pmcp-hooks"), { recursive: true });
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".agents/pmcp-hooks/policy.json"),
      '{"contract":2}\n',
    );
    writeFileSync(join(root, ".codex/hooks.json"), "{}");
    const found = currentHooks(root);
    expect(found.policySha256).toBe(sha256('{"contract":2}\n'));
    expect(found.codexHooksChanged).toBeGreaterThan(0);
  });
});

describe("the policy a session started under", () => {
  it("readCompiled carries the lock-verified hash", (t: TestContext) => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-hash-"));
    t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const text = `${JSON.stringify(compiled([]))}\n`;
    mkdirSync(join(root, ".agents/pmcp-hooks"), { recursive: true });
    writeFileSync(join(root, ".agents/pmcp-hooks/policy.json"), text);
    writeFileSync(
      join(root, "pmcp.lock"),
      JSON.stringify({
        outputs: [
          { path: ".agents/pmcp-hooks/policy.json", sha256: sha256(text) },
        ],
      }),
    );
    expect(readCompiled(root).policySha256).toBe(sha256(text));
  });

  it("is recorded at session start and kept while the session runs", async () => {
    const store = scratchStore();
    const policy = compiled([guard("sessions.registry", "warn")]);
    const run = async (native: string, name: string, hash: string) => {
      const input = RUNTIMES.claude.normalize(
        native,
        fixture("claude", name),
        "/w",
      )!;
      await dispatch(input, policy, {
        log: silentLogger,
        git: noGit,
        store,
        policySha256: hash,
        now: () => 0,
      });
      return input.session.id;
    };
    const session = await run("SessionStart", "SessionStart", "first");
    await run("PreToolUse", "PreToolUse.Bash", "second");
    expect(store.registry.get(session)?.["startPolicy"]).toBe("first");
  });
});
