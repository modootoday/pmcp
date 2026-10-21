import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { HOOK_FILE, POLICY_FILE, sha256 } from "../../../src/hooks/compiled.js";
import { harness, put, recorded, saveEvidence } from "./_shared.js";

let bundle = "";
const rows: Record<string, unknown>[] = [];
beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../../../src/hooks/entry.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
});
afterAll(() => saveEvidence("process", rows));

it.each(["claude", "codex"] as const)(
  "shares validator debounce between separate %s hook processes",
  (runtime) => {
    const h = harness(runtime, {
      checks: {
        after_edit: {
          validator_glob: "**/.agents/validate.cjs",
          command: [process.execPath, "{validator}"],
          debounce_seconds: 60,
          report: "context",
        },
      },
    });
    const count = join(h.root, "calls");
    put(
      join(h.root, "packages/one/.agents/validate.cjs"),
      `require("node:fs").appendFileSync(${JSON.stringify(count)}, "called\\n");\nprocess.exitCode = 1;\n`,
    );
    const policy = {
      ...h.policy,
      stateDir: join(h.root, "hook-state"),
      log: { ...h.policy.log, enabled: false },
    };
    const text = JSON.stringify(policy);
    put(join(h.root, POLICY_FILE), text);
    put(
      join(h.root, "pmcp.lock"),
      JSON.stringify({
        outputs: [{ path: POLICY_FILE, sha256: sha256(text) }],
      }),
    );
    put(join(h.root, HOOK_FILE), bundle);
    const file = join(h.root, "packages/one/a.ts");
    const tool_name = runtime === "claude" ? "Edit" : "apply_patch";
    const tool_input =
      runtime === "claude"
        ? { file_path: file }
        : {
            command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-old\n+new\n*** End Patch`,
          };
    const input = {
      ...recorded(runtime, "PostToolUse"),
      session_id: "t10-process-0001",
      cwd: h.root,
      tool_name,
      tool_input,
    };
    const outputs = [];
    for (let index = 0; index < 2; index += 1) {
      const result = spawnSync(
        process.execPath,
        [join(h.root, HOOK_FILE), runtime, "after_tool"],
        {
          cwd: h.root,
          env: { ...process.env, XDG_STATE_HOME: join(h.root, "xdg-state") },
          input: JSON.stringify(input),
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.status).toBe(0);
      outputs.push(result.stdout);
    }
    expect(outputs[0]).toContain("validation failed");
    expect(outputs[1]).toBe("");
    expect(readFileSync(count, "utf8")).toBe("called\n");
    rows.push({
      runtime,
      event: "after_tool",
      tool: tool_name,
      paths: [file],
      sessionState: { session: input.session_id, independentProcesses: 2 },
      expected: { verdict: "allow", validatorRuns: 1, stdout: outputs },
    });
  },
);
