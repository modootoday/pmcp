import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompiledPolicy } from "../src/hooks/compiled.js";
import { dispatch } from "../src/hooks/dispatch.js";
import { gitProbe } from "../src/hooks/policies/git-probe.js";
import { RUNTIMES } from "../src/hooks/runtimes/index.js";
import { createLogger } from "../src/logging/logger.js";
import { DEFAULT_LOG_SETTINGS } from "../src/logging/settings.js";
import { featureCatalog } from "../src/project/features/catalog.js";
import {
  featureSupport,
  readMeasurement,
} from "../src/project/features/support.js";
import { createFilesStore } from "../src/sessions/files-store.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-agy-sessions-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("antigravity sessions.registry and owners support", () => {
  it("reports sessions.registry and owners as measured for antigravity", () => {
    const measurement = readMeasurement("antigravity");
    expect(measurement).not.toBeNull();
    const catalog = featureCatalog(null);
    const registry = catalog.find((item) => item.id === "sessions.registry")!;
    const owners = catalog.find((item) => item.id === "owners")!;
    expect(featureSupport(registry, measurement)).toBe("measured");
    expect(featureSupport(owners, measurement)).toBe("measured");
  });

  it("normalizes write_file and edit_file Path args and tracks session lifecycle without session_end", async () => {
    const root = tempDir();
    const stateDir = tempDir();
    const store = createFilesStore(stateDir);
    const deps = {
      store,
      git: gitProbe,
      log: createLogger(() => {}, DEFAULT_LOG_SETTINGS),
      now: () => Date.now(),
    };
    const policy: CompiledPolicy = {
      contract: 2,
      targets: ["antigravity"],
      log: DEFAULT_LOG_SETTINGS,
      sessions: { staleMs: 60_000, keepBroadcasts: 10 },
      guards: [
        { id: "sessions.registry", mode: "warn", options: {} },
        {
          id: "owners",
          mode: "warn",
          options: {
            entries: [
              {
                paths: ["apps/billing/**"],
                owner: "billing-team",
                note: "check billing owner first",
                mode: "warn",
              },
            ],
          },
        },
      ],
      custom: [],
      lowering: { antigravity: { ask: "deny" } },
    };
    const adapter = RUNTIMES.antigravity;

    const startInput = adapter.normalize(
      "PreInvocation",
      {
        conversationId: "conv-agy-1",
        workspacePaths: [root],
        invocationNum: 0,
        initialNumSteps: 1,
      },
      root,
    );
    expect(startInput?.event).toBe("session_start");
    await dispatch(startInput!, policy, deps);
    expect(store.registry.get("conv-agy-1")?.runtime).toBe("antigravity");
    expect(store.registry.get("conv-agy-1")?.status).toBe("idle");

    const editBefore = adapter.normalize(
      "PreToolUse",
      {
        conversationId: "conv-agy-1",
        workspacePaths: [root],
        toolCall: {
          name: "edit_file",
          args: { Path: join(root, "apps/billing/index.ts") },
        },
      },
      root,
    );
    expect(editBefore?.tool?.kind).toBe("edit");
    expect(editBefore?.tool?.paths).toEqual([
      join(root, "apps/billing/index.ts"),
    ]);
    await dispatch(editBefore!, policy, deps);
    expect(store.registry.get("conv-agy-1")?.status).toBe("working");

    const editAfter = adapter.normalize(
      "PostToolUse",
      {
        conversationId: "conv-agy-1",
        workspacePaths: [root],
        toolCall: {
          name: "edit_file",
          args: { Path: join(root, "apps/billing/index.ts") },
        },
      },
      root,
    );
    const afterDecision = await dispatch(editAfter!, policy, deps);
    expect(afterDecision.context).toBeUndefined();

    const stopInput = adapter.normalize(
      "Stop",
      {
        conversationId: "conv-agy-1",
        workspacePaths: [root],
        executionNum: 0,
      },
      root,
    );
    const stopDecision = await dispatch(stopInput!, policy, deps);
    expect(stopDecision.context?.join("\n")).toContain("billing-team");
    expect(store.registry.get("conv-agy-1")?.status).toBe("idle");
  });
});
