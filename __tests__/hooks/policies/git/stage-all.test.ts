import { afterAll, describe, expect, it } from "vitest";
import { harness, saveEvidence } from "../../checks/_shared.js";

const blocked = [
  "git add -A",
  "git add --all",
  "git add .",
  "git add ./",
  "git add :/",
  "git add -- .",
  "git add -- :/",
  "git add -vA",
  "git add -Av",
  "git commit -a",
  "git commit -am sample",
  "git commit -vam sample",
  "git commit -nva -m sample",
  "git commit --all -m sample",
  "git -C elsewhere add -A",
  "env git add --all",
  "bash -c 'git add -A'",
  "git status && git add .",
  "echo $(git add -A)",
  "git commit -mspam -a",
  "git commit --message sample -a",
  "git commit -F message.txt -a",
  "git add 'unterminated",
];
const allowed = [
  "git add -- src/one.ts src/two.ts",
  "git add -p",
  "git add --patch",
  "git add src/one.ts",
  "git commit --only -m sample -- src/one.ts",
  "git commit -m 'docs: git add -A is forbidden'",
  "git commit -m 'docs: git commit -am sample is forbidden'",
  "git commit -m 'git add .' -- src/one.ts",
  "git commit -ma",
  "git commit --message='use git add --all'",
  "git commit -F -a",
  "git commit -- -a",
  "git add -- -A",
  "git add --pathspec-from-file .",
  "grep 'git add -A' README.md",
  "rg 'git commit -am' .",
  "echo 'git add :/'",
  "git status # git add -A",
  "git log -1",
  // Live false positive: no git at all, once failing to parse and refused as staging.
  'f=/x/chunk.js; n=$(grep -n "^function sanitizeEnvironment\\|function sanitizeEnvironment(" $f | head -1 | cut -d: -f1); echo $n',
  // Still unreadable, but it never names git, so stage_all has nothing to refuse.
  "echo 'unterminated",
];
const rows: Record<string, unknown>[] = [];
afterAll(() => saveEvidence("stage-all", rows));

describe.each(["claude", "codex"] as const)(
  "stage_all on recorded %s input",
  (runtime) => {
    it.each(blocked)("denies executed staging: %s", async (command) => {
      const h = harness(runtime, {
        guards: { git: { stage_all: { mode: "deny" } } },
      });
      const result = await h.run("PreToolUse", { tool_input: { command } });
      expect(result.decision.verdict).toBe("deny");
      expect(result.decision.reason).toContain("git.stage_all");
      rows.push(...h.rows);
    });
    it.each(allowed)("allows scoped work or a mention: %s", async (command) => {
      const h = harness(runtime, {
        guards: { git: { stage_all: { mode: "deny" } } },
      });
      const result = await h.run("PreToolUse", { tool_input: { command } });
      expect(result.decision.verdict).toBeUndefined();
      rows.push(...h.rows);
    });
    it("reports warn as context without denial", async () => {
      const h = harness(runtime, {
        guards: { git: { stage_all: { mode: "warn" } } },
      });
      const result = await h.run("PreToolUse", {
        tool_input: { command: "git add -A" },
      });
      expect(result.decision.verdict).toBeUndefined();
      expect(result.decision.context?.[0]).toContain("git.stage_all");
      rows.push(...h.rows);
    });
    it("applies the measured runtime ask lowering", async () => {
      const h = harness(runtime, {
        guards: { git: { stage_all: { mode: "ask" } } },
      });
      const result = await h.run("PreToolUse", {
        tool_input: { command: "git commit -am sample" },
      });
      expect(result.decision.verdict).toBe(
        runtime === "claude" ? "ask" : "deny",
      );
      rows.push(...h.rows);
    });
  },
);
