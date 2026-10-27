import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  legacyEntries,
  pinnedEntries,
  readCustom,
} from "../../src/hooks/compile/custom.js";
import type { HookInput } from "../../src/hooks/contract.js";
import { compiled, decide } from "./helpers.js";

// A project whose one custom guard refuses every shell command.
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-custom-mode-"));
  mkdirSync(join(root, ".agents/guards"), { recursive: true });
  const script = join(root, ".agents/guards/refuse.sh");
  writeFileSync(
    script,
    'echo \'{"decision":"deny","reason":"refused by the project"}\'\n',
  );
  return root;
}

// Run through sh: executing a file just written can fail with ETXTBSY while other tests fork.
// The longest timeout, so a loaded host does not turn the script's answer into a failure.
const entry = (mode?: string) => ({
  name: "refuse",
  command: ["sh", ".agents/guards/refuse.sh"],
  targets: ["claude"],
  timeout_ms: 60000,
  ...(mode === undefined ? {} : { mode }),
});

function shell(root: string): HookInput {
  return {
    contract: 2,
    runtime: "claude",
    event: "before_tool",
    session: { id: "abcd1234-session" },
    cwd: root,
    projectRoot: root,
    tool: { kind: "shell", native: "Bash", command: "ls", paths: [] },
  };
}

async function decideWith(root: string, mode?: string) {
  const entries = readCustom(root, {}, { custom: [entry(mode)] });
  const custom = pinnedEntries(root, entries, ["claude"]);
  return {
    custom,
    decision: await decide(shell(root), compiled([], { custom })),
  };
}

describe("[[hooks.guards.custom]] mode", () => {
  it("defaults to deny and keeps the compiled entry as before", async () => {
    const root = project();
    const { custom, decision } = await decideWith(root);
    expect(custom[0]).not.toHaveProperty("mode");
    expect(decision).toMatchObject({
      verdict: "deny",
      reason: "refused by the project",
    });
  });

  it("observe runs the guard and gives the runtime nothing", async () => {
    const root = project();
    const { custom, decision } = await decideWith(root, "observe");
    expect(custom[0]?.mode).toBe("observe");
    expect(decision.verdict).toBeUndefined();
    expect(decision.context ?? []).toEqual([]);
  });

  it("warn turns the refusal into context, and ask into ask", async () => {
    const root = project();
    const warned = await decideWith(root, "warn");
    expect(warned.decision.verdict).toBeUndefined();
    expect(warned.decision.context).toEqual([
      "pmcp custom.refuse: refused by the project",
    ]);
    const asked = await decideWith(root, "ask");
    expect(asked.decision.verdict).toBe("ask");
  });

  it("off drops the guard, and an unknown mode is refused", () => {
    const root = project();
    expect(readCustom(root, {}, { custom: [entry("off")] })).toEqual([]);
    expect(() => readCustom(root, {}, { custom: [entry("graded")] })).toThrow(
      "mode must be one of deny, ask, warn, observe, off",
    );
  });

  it("refuses a mode other than deny where the shell adapter serves the runtime", () => {
    const root = project();
    const [warn] = readCustom(
      root,
      {},
      {
        custom: [{ ...entry("warn"), targets: ["codex"] }],
      },
    );
    expect(() => legacyEntries([warn!], true, ["claude"])).toThrow(
      'custom guard refuse: mode = "warn" needs the hook bundle for codex',
    );
    expect(legacyEntries([warn!], true, ["codex"])).toEqual([]);
  });
});
