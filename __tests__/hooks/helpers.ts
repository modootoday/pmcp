import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledPolicy } from "../../src/hooks/compiled.js";
import type {
  Decision,
  HookInput,
  Mode,
  RuntimeId,
  Verdict,
} from "../../src/hooks/contract.js";
import { dispatch } from "../../src/hooks/dispatch.js";
import type { GitProbe } from "../../src/hooks/policies/types.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { silentLogger } from "../../src/logging/logger.js";
import { DEFAULT_LOG_SETTINGS } from "../../src/logging/settings.js";
import {
  createFilesStore,
  type FilesStoreOptions,
} from "../../src/sessions/files-store.js";
import type { SessionStore } from "../../src/sessions/types.js";

export const FIXTURE_VERSIONS: Readonly<Record<RuntimeId, string>> = {
  claude: "2.1.303",
  codex: "0.163.0",
  gemini: "0.63.0",
  antigravity: "1.3.3",
  grok: "1.0.50",
  opencode: "1.18.33",
};

export function fixture(runtime: RuntimeId, name: string): Record<string, any> {
  const dir = join(
    import.meta.dirname,
    "fixtures",
    runtime,
    FIXTURE_VERSIONS[runtime],
  );
  return JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
}

export const noGit: GitProbe = { toplevel: () => null, worktrees: () => [] };

const scratch: string[] = [];
process.on("exit", () =>
  scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

export function scratchStore(options: FilesStoreOptions = {}): SessionStore {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-store-"));
  scratch.push(dir);
  return createFilesStore(dir, options);
}

export const MAILBOX_ON = {
  enabled: true,
  ttlMinutes: 60,
  maxDelivered: 3,
  audit: true,
} as const;

export function compiled(
  guards: CompiledPolicy["guards"],
  more: Partial<CompiledPolicy> = {},
): CompiledPolicy {
  return {
    contract: 2,
    targets: ["claude", "codex"],
    log: { ...DEFAULT_LOG_SETTINGS, enabled: false },
    sessions: { staleMs: 30 * 60_000, keepBroadcasts: 10 },
    guards,
    custom: [],
    lowering: { codex: { ask: "deny" } },
    ...more,
  };
}

export interface Outcome {
  readonly verdict: Verdict | undefined;
  readonly stdout: string;
}

export async function decide(
  input: HookInput,
  policy: CompiledPolicy,
  options: { git?: GitProbe; store?: SessionStore } = {},
): Promise<Decision> {
  return dispatch(input, policy, {
    log: silentLogger,
    git: options.git ?? noGit,
    store: options.store ?? scratchStore(),
    now: () => 0,
  });
}

export async function runShell(
  runtime: RuntimeId,
  policy: CompiledPolicy,
  command: string,
  git: GitProbe = noGit,
  store?: SessionStore,
): Promise<Outcome> {
  const adapter = RUNTIMES[runtime];
  const payload = fixture(runtime, "PreToolUse.Bash");
  payload["tool_input"] = { ...payload["tool_input"], command };
  const input = adapter.normalize("PreToolUse", payload, payload["cwd"])!;
  const decision = await decide(input, policy, {
    git,
    ...(store ? { store } : {}),
  });
  return {
    verdict: decision.verdict,
    stdout: adapter.render(input, decision).stdout,
  };
}

export function guard(
  id: string,
  mode?: Mode,
  options: Record<string, unknown> = {},
): CompiledPolicy["guards"][number] {
  return { id, mode: mode ?? "deny", options };
}

export interface Cases {
  readonly blocked: readonly string[];
  readonly allowed: readonly string[];
}

export function cases(group: string, name: string): Cases {
  return JSON.parse(
    readFileSync(
      join(import.meta.dirname, "policies", group, `${name}.cases.json`),
      "utf8",
    ),
  );
}
