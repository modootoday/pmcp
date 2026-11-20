import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import type { RuntimeId } from "../../../../src/hooks/contract.js";
import { RUNTIMES } from "../../../../src/hooks/runtimes/index.js";
import type { WorktreeSyncOptions } from "../../../../src/hooks/policies/workspace/worktree-sync.js";
import {
  compiled,
  decide,
  fixture,
  guard,
  scratchStore,
} from "../../helpers.js";

const RUNTIMES_TO_TEST: RuntimeId[] = ["claude", "codex"];

const WORKTREE_OPTIONS: WorktreeSyncOptions = {
  root: ".claude/worktrees",
  onSessionStart: "fetch_and_move",
  betweenPrompts: "move_if_light",
  installAfterMove: "off",
  installWhen: ["bun.lock"],
  noticePaths: ["AGENTS.md"],
  followSubmodules: false,
};

// Compose policies into a unified fleet gate to test cross-policy interactions.
const fleetPolicy = compiled([
  guard("sessions.registry", "warn"),
  guard("git.shared_checkout", "warn"),
  guard(
    "git.worktrees.sync",
    "warn",
    WORKTREE_OPTIONS as unknown as Record<string, unknown>,
  ),
  guard("sessions.pause", "deny"),
]);

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=test", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function makeWorkspace(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-fleet-")));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "push", "-q", "origin", "HEAD:main");
  const desk = join(main, ".claude/worktrees/desk-a");
  git(
    main,
    "worktree",
    "add",
    "-q",
    "-b",
    "worktree-desk-a",
    desk,
    "origin/main",
  );
  const advance = (file: string, content = "content\n") => {
    writeFileSync(join(main, file), content);
    git(main, "add", file);
    git(main, "commit", "-q", "-m", `add ${file}`);
    git(main, "push", "-q", "origin", "HEAD:main");
  };
  return { root, origin, main, desk, advance };
}

function event(
  runtime: RuntimeId,
  name: "SessionStart" | "UserPromptSubmit",
  cwd: string,
  session = "test-session-1",
) {
  const payload: Record<string, any> = {
    ...fixture(runtime, name),
    cwd,
    session_id: session,
  };
  return RUNTIMES[runtime].normalize(payload["hook_event_name"], payload, cwd)!;
}

function edit(
  runtime: RuntimeId,
  cwd: string,
  file: string,
  session = "test-session-1",
) {
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
    session_id: session,
    tool_input: toolInput,
  };
  return RUNTIMES[runtime].normalize("PreToolUse", payload, cwd)!;
}

function shell(
  runtime: RuntimeId,
  cwd: string,
  command: string,
  session = "test-session-1",
) {
  const base = fixture(runtime, "PreToolUse.Bash");
  const payload = {
    ...base,
    cwd,
    session_id: session,
    tool_input: {
      ...base["tool_input"],
      command,
    },
  };
  return RUNTIMES[runtime].normalize("PreToolUse", payload, cwd)!;
}

describe.each(RUNTIMES_TO_TEST)(
  "fleet absorption policies across %s payloads",
  (runtime) => {
    describe("shared checkout write blocking and pause interaction", () => {
      it("blocks edits and mutating commands in shared checkout when workspace is paused by operator", (t) => {
        const { main } = makeWorkspace(t);
        const store = scratchStore();
        store.pause.write({ by: "operator", reason: "incident triage" });

        // Deny edits during pause while retaining shared checkout warning context.
        const editDecision = decide(
          edit(runtime, main, join(main, "file.ts")),
          fleetPolicy,
          { store },
        );
        return editDecision.then(async (out) => {
          expect(out.verdict).toBe("deny");
          expect(out.reason).toMatch(/workspace is paused \(incident triage/u);
          expect(out.context?.join("\n")).toMatch(
            /editing the shared checkout/u,
          );

          // Mutating commands must be denied while read-only commands proceed.
          const shellDeny = await decide(
            shell(runtime, main, "git commit -m fix"),
            fleetPolicy,
            { store },
          );
          expect(shellDeny.verdict).toBe("deny");
          expect(shellDeny.reason).toMatch(
            /workspace is paused \(incident triage/u,
          );

          const shellAllow = await decide(
            shell(runtime, main, "git status"),
            fleetPolicy,
            { store },
          );
          expect(shellAllow.verdict).toBeUndefined();
        });
      });

      it("allows pauser session by session id or alias to edit and run mutating commands in shared checkout", async (t) => {
        const { main } = makeWorkspace(t);
        const store = scratchStore();
        store.pause.write({ by: "lead-session", reason: "schema refactor" });

        const editDecision = await decide(
          edit(runtime, main, join(main, "lead.ts"), "lead-session"),
          fleetPolicy,
          { store },
        );
        expect(editDecision.verdict).toBeUndefined();
        expect(editDecision.context?.join("\n")).toMatch(
          /editing the shared checkout/u,
        );

        // Alias matching pauser identity also bypasses pause restrictions.
        store.pause.write({ by: "lead-alias", reason: "schema refactor" });
        store.registry.upsert("worker-session", {
          alias: "lead-alias",
          cwd: main,
        });
        const cmdDecision = await decide(
          shell(runtime, main, "git commit -m lead", "worker-session"),
          fleetPolicy,
          { store },
        );
        expect(cmdDecision.verdict).toBeUndefined();
      });

      it("allows edits and mutating commands again after operator resumes workspace", async (t) => {
        const { main } = makeWorkspace(t);
        const store = scratchStore();
        store.pause.write({ by: "operator", reason: "triage" });

        const pausedOut = await decide(
          edit(runtime, main, join(main, "f.ts")),
          fleetPolicy,
          { store },
        );
        expect(pausedOut.verdict).toBe("deny");

        // Clear pause state to verify seamless resumption across tools.
        store.pause.write(null);
        const resumedEdit = await decide(
          edit(runtime, main, join(main, "f.ts")),
          fleetPolicy,
          { store },
        );
        expect(resumedEdit.verdict).toBeUndefined();

        const resumedShell = await decide(
          shell(runtime, main, "git commit -m resumed"),
          fleetPolicy,
          { store },
        );
        expect(resumedShell.verdict).toBeUndefined();
      });
    });

    describe("stale worktree sync warnings and blocking", () => {
      it("blocks worktree sync at session start while workspace is paused, and warns why", async (t) => {
        const { desk, advance } = makeWorkspace(t);
        advance("AGENTS.md", "new rules\n");
        const store = scratchStore();
        store.pause.write({ by: "operator", reason: "tree freeze" });

        const out = await decide(
          event(runtime, "SessionStart", desk),
          fleetPolicy,
          { store },
        );
        expect(out.context?.[0]).toMatch(
          /Worktree .* was not moved: the workspace is paused \(tree freeze\)\./u,
        );
        expect(git(desk, "log", "-1", "--format=%s")).toBe("init");

        // Prompts stay stable and surface workspace pause notification.
        const promptOut = await decide(
          event(runtime, "UserPromptSubmit", desk),
          fleetPolicy,
          { store },
        );
        expect(promptOut.context?.[0]).toMatch(
          /The workspace is paused \(tree freeze/u,
        );
      });

      it("successfully syncs worktree on session start once workspace is resumed", async (t) => {
        const { desk, advance } = makeWorkspace(t);
        advance("AGENTS.md", "new rules\n");
        const store = scratchStore();
        store.pause.write({ by: "operator", reason: "freeze" });

        await decide(event(runtime, "SessionStart", desk), fleetPolicy, {
          store,
        });
        expect(git(desk, "log", "-1", "--format=%s")).toBe("init");

        // Unpausing allows subsequent session start to fast-forward and report changed rules.
        store.pause.write(null);
        const out = await decide(
          event(runtime, "SessionStart", desk),
          fleetPolicy,
          { store },
        );
        expect(git(desk, "log", "-1", "--format=%s")).toBe("add AGENTS.md");
        expect(out.context?.join("\n")).toMatch(
          /These rule files changed with the move; re-read them before going on: AGENTS\.md/u,
        );
      });

      it("leaves worktree with uncommitted changes where it is and warns about dirty state", async (t) => {
        const { desk, advance } = makeWorkspace(t);
        advance("new-feature.txt");
        writeFileSync(join(desk, "local-wip.txt"), "wip\n");
        git(desk, "add", "local-wip.txt");

        const out = await decide(
          event(runtime, "SessionStart", desk),
          fleetPolicy,
          { store: scratchStore() },
        );
        expect(out.context?.join("\n")).toMatch(
          /Worktree .* uncommitted changes; left where it is/u,
        );
        expect(git(desk, "log", "-1", "--format=%s")).toBe("init");
      });

      it("warns between prompts when upstream changes lockfile without moving the worktree", async (t) => {
        const { desk, advance } = makeWorkspace(t);
        advance("bun.lock", "lockfile v2\n");
        git(desk, "fetch", "-q", "origin");

        // Prompt hook must not mutate worktree but must notify about dependency drift.
        const out = await decide(
          event(runtime, "UserPromptSubmit", desk),
          fleetPolicy,
          { store: scratchStore() },
        );
        expect(out.context?.[0]).toMatch(
          /origin\/main changed bun\.lock; this linked worktree moves at the next session start or with pmcp git worktree sync\./u,
        );
        expect(git(desk, "log", "-1", "--format=%s")).toBe("init");
      });

      it("holds worktree sync when an active delivery lease is held", async (t) => {
        const { desk, advance } = makeWorkspace(t);
        advance("feature.txt");
        const store = scratchStore();
        store.leases.take("lockfile", {
          subject: "upgrading dependency packages",
        });

        const out = await decide(
          event(runtime, "SessionStart", desk),
          fleetPolicy,
          { store },
        );
        expect(out.context?.[0]).toMatch(
          /was not moved: a change under lease lockfile is being delivered \(upgrading dependency packages\)/u,
        );
        expect(git(desk, "log", "-1", "--format=%s")).toBe("init");

        // Releasing the lease unblocks sync on the next session start.
        store.leases.release("lockfile");
        const resumedOut = await decide(
          event(runtime, "SessionStart", desk),
          fleetPolicy,
          { store },
        );
        expect(resumedOut.context?.join("\n")).not.toMatch(/was not moved/u);
        expect(git(desk, "log", "-1", "--format=%s")).toBe("add feature.txt");
      });
    });

    describe("shared checkout warnings and leftover tracking", () => {
      it("warns on session start in shared checkout but never in linked worktrees", async (t) => {
        const { main, desk } = makeWorkspace(t);
        const store = scratchStore();

        // Primary checkout emits single session start warning.
        const outMain = await decide(
          event(runtime, "SessionStart", main, "sess-1"),
          fleetPolicy,
          { store },
        );
        expect(outMain.context?.[0]).toMatch(
          /This session works in the shared checkout .* not a linked worktree/u,
        );

        const promptMain = await decide(
          event(runtime, "UserPromptSubmit", main, "sess-1"),
          fleetPolicy,
          { store },
        );
        expect(promptMain.context?.join("\n")).toMatch(
          /This session works in the shared checkout .* not a linked worktree/u,
        );

        const outDesk = await decide(
          event(runtime, "SessionStart", desk, "sess-2"),
          fleetPolicy,
          { store: scratchStore() },
        );
        expect(outDesk.context).toBeUndefined();
      });

      it("warns when other live claimant sessions are active in the same shared checkout", async (t) => {
        const { main } = makeWorkspace(t);
        const store = scratchStore();
        store.registry.upsert("other-agent", {
          cwd: main,
          alias: "reviewer",
          pid: process.pid,
        });

        const out = await decide(
          edit(runtime, main, join(main, "shared-doc.md"), "current-session"),
          fleetPolicy,
          { store },
        );
        expect(out.context?.join("\n")).toMatch(
          /Another live session works in .* reviewer/u,
        );
        expect(out.context?.join("\n")).toMatch(
          /You are editing the shared checkout/u,
        );
      });

      it("tracks leftovers in shared checkout and warns on prompt until cleared", async (t) => {
        const { main } = makeWorkspace(t);
        const store = scratchStore();
        await decide(
          event(runtime, "SessionStart", main, "sess-track"),
          fleetPolicy,
          { store },
        );

        const target = join(main, "uncommitted.txt");
        await decide(edit(runtime, main, target, "sess-track"), fleetPolicy, {
          store,
        });
        writeFileSync(target, "draft\n");

        const prompt1 = await decide(
          event(runtime, "UserPromptSubmit", main, "sess-track"),
          fleetPolicy,
          { store },
        );
        expect(prompt1.context?.[0]).toMatch(
          /You left 1 uncommitted file\(s\) in the shared checkout .* uncommitted\.txt/u,
        );

        // Notice deduplication prevents spamming on unchanged dirty set.
        const promptRepeat = await decide(
          event(runtime, "UserPromptSubmit", main, "sess-track"),
          fleetPolicy,
          { store },
        );
        expect(promptRepeat.context).toBeUndefined();

        // Committing or cleaning the leftover clears dirty state.
        git(main, "add", "uncommitted.txt");
        git(main, "commit", "-q", "-m", "committing draft");
        const promptClean = await decide(
          event(runtime, "UserPromptSubmit", main, "sess-track"),
          fleetPolicy,
          { store },
        );
        expect(promptClean.context).toBeUndefined();
      });
    });

    describe("multi-session fleet pause/resume coordination", () => {
      it("enforces fleet-wide pause across main and worktrees, and resumes cleanly", async (t) => {
        const { main, desk } = makeWorkspace(t);
        const store = scratchStore();
        store.registry.upsert("session-a", {
          cwd: main,
          alias: "coordinator",
          pid: process.pid,
        });
        store.registry.upsert("session-b", {
          cwd: desk,
          alias: "worker",
          pid: process.pid,
        });

        store.pause.write({ by: "operator", reason: "fleet rollout" });

        // Both sessions in different working copies observe pause state.
        const promptA = await decide(
          event(runtime, "UserPromptSubmit", main, "session-a"),
          fleetPolicy,
          { store },
        );
        expect(promptA.context?.join("\n")).toMatch(
          /workspace is paused \(fleet rollout/u,
        );

        const cmdA = await decide(
          shell(runtime, main, "bun run deploy", "session-a"),
          fleetPolicy,
          { store },
        );
        expect(cmdA.verdict).toBe("deny");

        const promptB = await decide(
          event(runtime, "UserPromptSubmit", desk, "session-b"),
          fleetPolicy,
          { store },
        );
        expect(promptB.context?.[0]).toMatch(
          /workspace is paused \(fleet rollout/u,
        );

        const editB = await decide(
          edit(runtime, desk, join(desk, "feature.ts"), "session-b"),
          fleetPolicy,
          { store },
        );
        expect(editB.verdict).toBe("deny");

        // Resuming restores full operations for all fleet members.
        store.pause.write(null);

        const cmdA2 = await decide(
          shell(runtime, main, "git commit -m ok", "session-a"),
          fleetPolicy,
          { store },
        );
        expect(cmdA2.verdict).toBeUndefined();

        const editB2 = await decide(
          edit(runtime, desk, join(desk, "feature.ts"), "session-b"),
          fleetPolicy,
          { store },
        );
        expect(editB2.verdict).toBeUndefined();

        const promptCleanA = await decide(
          event(runtime, "UserPromptSubmit", main, "session-a"),
          fleetPolicy,
          { store },
        );
        expect(promptCleanA.context).toBeUndefined();

        const promptCleanB = await decide(
          event(runtime, "UserPromptSubmit", desk, "session-b"),
          fleetPolicy,
          { store },
        );
        expect(promptCleanB.context).toBeUndefined();
      });
    });
  },
);
