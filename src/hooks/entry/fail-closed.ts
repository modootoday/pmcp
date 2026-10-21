import { readFileSync } from "node:fs";
import { join } from "node:path";

import { POLICY_FILE, PolicyIntegrityError } from "../compiled.js";
import type { HookInput, NeutralEvent } from "../contract.js";
import {
  PASS_KINDS,
  passes,
  type FailureSettings,
} from "../dispatch/failure.js";
import type { RuntimeAdapter } from "../runtimes/types.js";

const FAILED_CLOSED = "pmcp hook could not evaluate this call and refused it";

// Only tool calls can be refused; keep other events silent so hook errors cannot block session startup.
// [hooks.failure] as projected, read without compiling the policy: the compile may be what
// failed. A policy that fails its integrity check is not trusted for this either.
export function rawFailure(root: string): FailureSettings | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(root, POLICY_FILE), "utf8"))[
      "failure"
    ] as Partial<FailureSettings> | undefined;
    if (
      !raw ||
      typeof raw.timeoutMs !== "number" ||
      typeof raw.retry !== "number" ||
      !Array.isArray(raw.pass) ||
      !raw.pass.every((kind) =>
        (PASS_KINDS as readonly string[]).includes(kind),
      )
    )
      return undefined;
    return { timeoutMs: raw.timeoutMs, retry: raw.retry, pass: raw.pass };
  } catch {
    return undefined;
  }
}

// The whole entry failed (it could not compile, read the store or evaluate): with
// [hooks.failure] a read, or an edit in the session's own worktree, still passes with the
// one-line warning, judged from the call alone; anything else is refused with that line.
export function failedEntry(
  adapter: RuntimeAdapter,
  event: NeutralEvent,
  root: string,
  input: HookInput | null,
  failure: FailureSettings,
  error: unknown,
): string {
  if (event !== "before_tool") return "";
  const cause = `error: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`;
  const head = `pmcp hooks: the hook failed (${cause})`;
  if (input && passes(input, failure.pass))
    return adapter.render(input, {
      context: [`${head}; passed with a warning`],
    }).stdout;
  return failClosed(adapter, event, root, new Error(`${head}; refused`), true);
}

export function failClosed(
  adapter: RuntimeAdapter,
  event: NeutralEvent,
  root: string,
  error: unknown,
  // The error message is already the reason to show (failedEntry).
  stated = false,
): string {
  if (event !== "before_tool") return "";
  const reason =
    error instanceof PolicyIntegrityError || (stated && error instanceof Error)
      ? error.message
      : FAILED_CLOSED;
  const input: HookInput = {
    contract: 2,
    runtime: adapter.id,
    event,
    session: { id: "" },
    cwd: root,
    projectRoot: root,
  };
  return adapter.render(input, { verdict: "deny", reason }).stdout;
}
