import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, type TestContext } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../../helpers.js";

const policy = compiled([
  guard("sessions.registry", "warn"),
  guard("git.shared_checkout", "warn"),
]);
// A shared identifier lets recordings from different sessions exercise one session lifecycle.
const SESSION = "pmcp-shared-test-0001";

function workspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-shared-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  execFileSync(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    { cwd: main },
  );
  execFileSync(
    "git",
    ["worktree", "add", "-q", "-b", "desk-a", join(root, "desk")],
    { cwd: main },
  );
  return { main, desk: join(root, "desk") };
}

function edit(runtime: RuntimeId, cwd: string, file: string, session?: string) {
  const name =
    runtime === "claude" ? "PreToolUse.Edit" : "PreToolUse.apply_patch";
  const base = fixture(runtime, name);
  const toolInput =
    runtime === "claude"
      ? { ...base["tool_input"], file_path: file }
      : {
          command: `*** Begin Patch\n*** Update File: ${file}\n@@\n+x\n*** End Patch`,
        };
  const payload = {
    ...base,
    cwd,
    tool_input: toolInput,
    session_id: session ?? SESSION,
  };
  return RUNTIMES[runtime].normalize("PreToolUse", payload, cwd)!;
}

function event(runtime: RuntimeId, name: string, cwd: string) {
  const payload: Record<string, any> = {
    ...fixture(runtime, name),
    cwd,
    session_id: SESSION,
  };
  return RUNTIMES[runtime].normalize(payload["hook_event_name"], payload, cwd)!;
}

describe.each(["claude", "codex"] as const)(
  "git.shared_checkout on %s payloads",
  (runtime) => {
    it("warns once at session start in the main checkout and never in a desk", async (t) => {
      const { main, desk } = workspace(t);
      const store = scratchStore();
      expect(
        (await decide(event(runtime, "SessionStart", main), policy, { store }))
          .context?.[0],
      ).toMatch(/shared checkout .*not a linked worktree/u);
      expect(
        (
          await decide(event(runtime, "UserPromptSubmit", main), policy, {
            store,
          })
        ).context,
      ).toBeUndefined();
      expect(
        (
          await decide(event(runtime, "SessionStart", desk), policy, {
            store: scratchStore(),
          })
        ).context,
      ).toBeUndefined();
    });

    it("tracks edits in the main checkout and names the leftovers once", async (t) => {
      const { main } = workspace(t);
      const store = scratchStore();
      await decide(event(runtime, "SessionStart", main), policy, { store });
      const file = join(main, "notes.md");
      expect(
        (
          await decide(edit(runtime, main, file), policy, { store })
        ).context?.join("\n"),
      ).toMatch(/editing the shared checkout .*Deliver this change/u);
      expect(
        (await decide(edit(runtime, main, file), policy, { store })).context,
      ).toBeUndefined();
      writeFileSync(file, "left behind\n");
      expect(
        (
          await decide(event(runtime, "UserPromptSubmit", main), policy, {
            store,
          })
        ).context?.[0],
      ).toMatch(/1 uncommitted file\(s\).*notes\.md/u);
      expect(
        (
          await decide(event(runtime, "UserPromptSubmit", main), policy, {
            store,
          })
        ).context,
      ).toBeUndefined();
    });

    it("names another live session working in the same checkout", async (t) => {
      const { desk } = workspace(t);
      const store = scratchStore();
      store.registry.upsert("other-session-1", {
        cwd: desk,
        alias: "kit",
        pid: process.pid,
      });
      const out = await decide(
        edit(runtime, desk, join(desk, "a.ts")),
        policy,
        { store },
      );
      expect(out.context?.[0]).toMatch(
        /Another live session works in .*: kit/u,
      );
      expect(out.verdict).toBeUndefined();
    });
  },
);
