import { describe, expect, it } from "vitest";

import { compileHooks } from "../../../src/hooks/compile.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { compiled, decide, fixture } from "../helpers.js";

const claude = RUNTIMES.claude;
const codex = RUNTIMES.codex;

describe("claude adapter on recorded 2.1.303 payloads", () => {
  it("normalizes a shell call with its prompt id as the turn", () => {
    const payload = fixture("claude", "PreToolUse.Bash");
    const input = claude.normalize("PreToolUse", payload, payload["cwd"])!;
    expect(input.event).toBe("before_tool");
    expect(input.tool).toMatchObject({
      kind: "shell",
      native: "Bash",
      command: payload["tool_input"].command,
    });
    expect(input.session).toEqual({
      id: payload["session_id"],
      turnId: payload["prompt_id"],
    });
  });

  it.each(["Write", "Edit"])(
    "normalizes %s as an edit of its file_path",
    (tool) => {
      const payload = fixture("claude", `PreToolUse.${tool}`);
      const input = claude.normalize("PreToolUse", payload, payload["cwd"])!;
      expect(input.tool).toMatchObject({
        kind: "edit",
        paths: [payload["tool_input"].file_path],
      });
    },
  );

  it("normalizes every recorded event", () => {
    for (const name of [
      "SessionStart",
      "UserPromptSubmit",
      "PostToolUse.Bash",
      "Stop",
      "SessionEnd",
    ]) {
      const payload = fixture("claude", name);
      expect(
        claude.normalize(payload["hook_event_name"], payload, payload["cwd"]),
      ).not.toBeNull();
    }
  });

  it("renders deny and ask in hookSpecificOutput and never writes an allow", () => {
    const input = claude.normalize(
      "PreToolUse",
      fixture("claude", "PreToolUse.Bash"),
      "/",
    )!;
    expect(
      JSON.parse(claude.render(input, { verdict: "ask", reason: "r" }).stdout),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "r",
      },
    });
    expect(claude.render(input, { verdict: "allow" }).stdout).toBe("");
  });

  it("delivers Stop context through hookSpecificOutput", () => {
    const input = claude.normalize("Stop", fixture("claude", "Stop"), "/")!;
    expect(
      JSON.parse(claude.render(input, { context: ["c"] }).stdout)
        .hookSpecificOutput.additionalContext,
    ).toBe("c");
  });
});

describe("codex adapter on recorded 0.163.0 payloads", () => {
  it("normalizes apply_patch as an edit of the absolute paths in its headers", () => {
    const payload = fixture("codex", "PreToolUse.apply_patch");
    const input = codex.normalize("PreToolUse", payload, payload["cwd"])!;
    expect(input.tool?.kind).toBe("edit");
    expect(input.tool?.paths).toEqual([
      "/rec/work/workspace/notes/recorded.txt",
    ]);
    expect(input.session.turnId).toBe(payload["turn_id"]);
  });

  it("normalizes every recorded event, SessionEnd included", () => {
    for (const name of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse.Bash",
      "PostToolUse.apply_patch",
      "Stop",
      "SessionEnd",
    ]) {
      const payload = fixture("codex", name);
      expect(
        codex.normalize(payload["hook_event_name"], payload, payload["cwd"]),
      ).not.toBeNull();
    }
  });

  it("writes an ask as a deny because Codex has no ask", () => {
    const input = codex.normalize(
      "PreToolUse",
      fixture("codex", "PreToolUse.Bash"),
      "/",
    )!;
    expect(
      JSON.parse(codex.render(input, { verdict: "ask", reason: "r" }).stdout)
        .hookSpecificOutput.permissionDecision,
    ).toBe("deny");
  });

  it("answers Stop with an empty object or a decision, never hookSpecificOutput", () => {
    const input = codex.normalize("Stop", fixture("codex", "Stop"), "/")!;
    expect(codex.render(input, {}).stdout).toBe("{}\n");
    expect(JSON.parse(codex.render(input, { context: ["c"] }).stdout)).toEqual(
      {},
    );
    expect(JSON.parse(codex.render(input, { feedback: "f" }).stdout)).toEqual({
      decision: "block",
      reason: "f",
    });
  });

  it("binds no Notification because Codex has none", () => {
    expect(codex.bindings("notification", [], 10)).toEqual([]);
    expect(codex.bindings("session_end", [], 10)).toHaveLength(1);
  });

  it("projects SessionEnd at no more than the 3 s Codex allows, leaving other events and Claude alone", () => {
    expect(codex.bindings("session_end", [], 17)[0]?.timeoutSec).toBe(3);
    expect(codex.bindings("session_end", [], 2)[0]?.timeoutSec).toBe(2);
    expect(codex.bindings("stop", [], 17)[0]?.timeoutSec).toBe(17);
    expect(claude.bindings("session_end", [], 17)[0]?.timeoutSec).toBe(17);
    const projected = compileHooks(
      { sessions: { registry: {} } },
      { root: "/", tools: new Set(["claude", "codex"]) },
    );
    const end = (file: string) =>
      projected.edits.find(
        (edit) => edit.file === file && edit.key[1] === "SessionEnd",
      )?.entries[0] as { hooks: { timeout: number }[] } | undefined;
    expect(end(".codex/hooks.json")?.hooks[0]?.timeout).toBe(3);
    expect(end(".claude/settings.json")?.hooks[0]?.timeout).toBe(10);
  });
});

describe("stop loop", () => {
  it("stays quiet on a Stop that a hook already continued", async () => {
    for (const runtime of ["claude", "codex"] as const) {
      const payload = { ...fixture(runtime, "Stop"), stop_hook_active: true };
      const input = RUNTIMES[runtime].normalize("Stop", payload, "/")!;
      const policy = compiled([]);
      const decision = await decide(input, policy);
      expect(decision).toEqual({});
    }
  });
});
