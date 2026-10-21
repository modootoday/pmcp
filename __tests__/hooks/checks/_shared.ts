import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import { compileHooks } from "../../../src/hooks/compile.js";
import type { RuntimeId } from "../../../src/hooks/contract.js";
import { dispatch } from "../../../src/hooks/dispatch.js";
import { RUNTIMES } from "../../../src/hooks/runtimes/index.js";
import { silentLogger } from "../../../src/logging/logger.js";
import { createFilesStore } from "../../../src/sessions/files-store.js";
import { fixture, noGit } from "../helpers.js";

const scratch: string[] = [];
afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

export function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// The tracked recordings only: tool events start from the Bash call, and edit() overrides
// the tool name and input it needs.
export function recorded(
  runtime: RuntimeId,
  event: string,
): Record<string, any> {
  const tool = event === "PreToolUse" || event === "PostToolUse";
  return fixture(runtime, tool ? `${event}.Bash` : event);
}

export function harness(runtime: RuntimeId, hooks: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-guard-check-"));
  scratch.push(root);
  let store = createFilesStore(join(root, "state"));
  const policy = compileHooks(
    { hooks },
    { root, tools: new Set([runtime]) },
  ).policy!;
  const rows: Record<string, unknown>[] = [];
  let failures = 0;
  const log = {
    ...silentLogger,
    error: () => {
      failures += 1;
    },
  };
  log.child = () => log;
  async function run(event: string, overrides: Record<string, unknown> = {}) {
    const raw = {
      ...recorded(runtime, event),
      cwd: root,
      session_id: "session-0001",
      prompt_id: "turn-one",
      turn_id: "turn-one",
      stop_hook_active: false,
      ...overrides,
    };
    const input = RUNTIMES[runtime].normalize(event, raw, root)!;
    const before = store.registry.get(input.session.id);
    const decision = await dispatch(input, policy, {
      store,
      git: noGit,
      log,
      now: () => Date.now(),
    });
    const rendered = RUNTIMES[runtime].render(input, decision);
    rows.push({
      runtime,
      event: input.event,
      tool: input.tool?.native ?? null,
      command: input.tool?.command ?? null,
      paths: input.tool?.paths ?? [],
      sessionState: before,
      input,
      expected: {
        verdict: decision.verdict ?? "allow",
        context: decision.context ?? [],
        stdout: rendered.stdout,
      },
    });
    return { decision, rendered, input };
  }
  async function edit(path: string) {
    const tool_name = runtime === "claude" ? "Edit" : "apply_patch";
    const tool_input =
      runtime === "claude"
        ? { file_path: path }
        : {
            command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+new\n*** End Patch`,
          };
    return run("PostToolUse", { tool_name, tool_input });
  }
  return {
    root,
    store,
    policy,
    rows,
    run,
    edit,
    failures: () => failures,
    reloadStore: () => {
      store = createFilesStore(store.dir);
    },
  };
}

export function saveEvidence(name: string, rows: readonly unknown[]): void {
  const directory = process.env["PMCP_T10_EVIDENCE_DIR"];
  if (!directory) return;
  put(join(directory, `${name}.json`), JSON.stringify(rows, null, 2) + "\n");
}
